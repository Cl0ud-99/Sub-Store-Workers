import { runSubStoreEngine } from '../generated/substore-engine.js';
// No import-time I/O and no singleton upstream caches shared across tenants.
export async function initSubStore($request) {
    globalThis.$request = $request;
    runSubStoreEngine();
}
export function resetSubStore() {}
