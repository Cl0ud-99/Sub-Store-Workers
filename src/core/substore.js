import { setupGlobals } from './globals.js';
import { createUserStorage } from './storage.js';
import { parseRequest, buildResponse, buildErrorResponse } from './request.js';
import { initSubStore } from './substore-loader.js';

// The upstream engine uses globals. Serialize it within an isolate and instantiate
// all its caches per request. CAS persistence protects concurrent different isolates.
// Do not share pending promises across Workers requests. A cancelled queue waiter
// must not leave an unresolvable promise behind and poison the whole isolate.
let activeLease = null;
async function exclusive(task) {
    const waitStarted = Date.now();
    while (activeLease && Date.now() < activeLease.expiresAt) {
        if (Date.now() - waitStarted > 50000) throw new Error('Server busy; retry shortly');
        // The timer and its promise belong to THIS request, not the previous one.
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    const lease = { expiresAt: Date.now() + 70000 };
    activeLease = lease;
    try { return await task(); }
    finally { if (activeLease === lease) activeLease = null; }
}

async function execute({user, env, ctx, $request, timeout = 45000}) {
    const current = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    if (!current || current.path !== user.path) throw new Error('User no longer available');
    const store = createUserStorage(current);
    let settings = {};
    try { settings = JSON.parse(current.data || '{}').__settings__ || {}; } catch {}
    globalThis.__substore_tasks__ = new Set();
    globalThis.__substore_controllers__ = new Set();
    setupGlobals(env, settings, ctx);
    globalThis.$persistentStore = store;
    globalThis.$request = $request;
    let timer, finished = false;
    const tasks = globalThis.__substore_tasks__;
    const controllers = globalThis.__substore_controllers__;
    const done = new Promise(resolve => {
        globalThis.$done = result => { if (!finished) { finished = true; resolve(result); } };
        timer = setTimeout(() => {
            finished = true;
            for (const controller of controllers) controller.abort();
            resolve({status: 504, body: JSON.stringify({status: 'failed', message: 'Request timed out'})});
        }, timeout);
    });
    try {
        await initSubStore($request);
        const result = await done;
        for (const controller of controllers) controller.abort();
        while (tasks.size) await Promise.allSettled([...tasks]);
        clearTimeout(timer);
        const data = JSON.stringify(store.getData());
        if (data !== (current.data || '{}')) {
            const update = await env.DB.prepare('UPDATE users SET data = ?, updated_at = ? WHERE id = ? AND data = ?')
                .bind(data, Date.now(), current.id, current.data).run();
            if (update.meta.changes !== 1) throw new Error('Concurrent update detected; please retry');
        }
        return result;
    } finally {
        clearTimeout(timer);
        for (const controller of controllers) controller.abort();
        while (tasks.size) await Promise.allSettled([...tasks]);
        globalThis.$done = () => {};
        globalThis.$request = undefined;
        globalThis.$persistentStore = undefined;
        globalThis.__substore_dispatch__ = undefined;
        globalThis.__user_data__ = undefined;
        globalThis.__substore_tasks__ = undefined;
        globalThis.__substore_controllers__ = undefined;
    }
}

export async function handleSubStoreHttpRequest({user, env, ctx, request, subStorePath}) {
    // Read the body outside the lock; no shared engine state here.
    const $request = await parseRequest(request, subStorePath);
    return exclusive(async () => {
        try { return buildResponse(await execute({user, env, ctx, $request}), $request); }
        catch (err) {
            console.error('[SubStore] Request failed:', err.stack || err.message);
            return buildErrorResponse(err.message || 'Internal Server Error');
        }
    });
}

export async function handleSubStoreCronRequest({user, env}) {
    return exclusive(async () => {
        try {
            await execute({user, env, timeout: 55000, $request: {
                method: 'GET', url: 'https://sub-store.internal/api/utils/refresh',
                path: '/api/utils/refresh', headers: {}, body: '',
            }});
        } catch (err) { console.error('[SubStore] Refresh failed:', err.message); }
    });
}
