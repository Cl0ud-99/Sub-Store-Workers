import { SignJWT, jwtVerify } from 'jose';
function key(env) {
    if (!env?.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be configured');
    return new TextEncoder().encode(env.JWT_SECRET);
}
export async function signToken(payload, env) {
    return new SignJWT(payload).setProtectedHeader({alg: 'HS256'}).setIssuedAt().setExpirationTime('7d').sign(key(env));
}
export async function verifyToken(token, env) {
    try { return (await jwtVerify(token, key(env))).payload; } catch { return null; }
}
export async function authenticateRequest(request, env) {
    const header = request.headers.get('Authorization');
    if (!header?.startsWith('Bearer ')) return null;
    return verifyToken(header.slice(7), env);
}
