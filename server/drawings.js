const MAX_BYTES = 1024 * 1024;
const TEST_SITEKEY = '1x00000000000000000000AA';
const TEST_SECRET = '1x0000000000000000000000000000000AA';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function reply(data, status = 200, extra = {}) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}

function configured(env, url) {
    const testing = env.TURNSTILE_SITE_KEY === TEST_SITEKEY || env.TURNSTILE_SECRET_KEY === TEST_SECRET;
    return (env.DRAWINGS_ENABLED === 'true' || env.DRAWINGS_ENABLED === true) && !!env.DRAWINGS && !!env.DRAWINGS_RATE_LIMITER
        && !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET_KEY && (!testing || LOCAL_HOSTS.has(url.hostname));
}

// Check the PNG envelope, CRCs and fixed canvas geometry before private storage.
// This is not an image decoder or content-moderation service. No public serving endpoint exists.
export function validDrawing(bytes) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length > MAX_BYTES || bytes.length < 57 || !signature.every((value, i) => bytes[i] === value)) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    let header = false;
    let data = false;
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        if (length > MAX_BYTES || offset + length + 12 > bytes.length) return false;
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        let crc = 0xffffffff;
        for (let i = offset + 4; i < offset + 8 + length; i++) {
            crc ^= bytes[i];
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(offset + 8 + length)) return false;
        if (!header && type !== 'IHDR') return false;
        if (type === 'IHDR') {
            if (header || length !== 13 || view.getUint32(offset + 8) !== 800 || view.getUint32(offset + 12) !== 500
                || bytes[offset + 16] !== 8 || ![2, 6].includes(bytes[offset + 17])
                || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) return false;
            header = true;
        } else if (type === 'IDAT') {
            data ||= length > 0;
        } else if (type === 'IEND') {
            return header && data && length === 0 && offset + 12 === bytes.length;
        } else if (!['sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type)) return false;
        offset += length + 12;
    }
    return false;
}

async function readLimited(request) {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_BYTES) { await reader.cancel(); return null; }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
}

export async function handleDrawings({ request, env }, dependencies = {}) {
    const url = new URL(request.url);
    if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
    const enabled = configured(env, url);
    if (request.method === 'GET') return reply({ enabled, ...(enabled ? { sitekey: env.TURNSTILE_SITE_KEY, maxBytes: MAX_BYTES } : {}) });
    if (!enabled) return reply({ error: 'The drawing inbox is not connected yet. Your drawing has not been sent.' }, 503);
    if (request.headers.get('Origin') !== url.origin) return reply({ error: 'Please send drawings from this website.' }, 403);
    if (request.headers.get('Content-Type') !== 'image/png') return reply({ error: 'Only canvas PNG drawings are accepted.' }, 415);
    if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return reply({ error: 'Drawing is too large.' }, 413);
    const token = request.headers.get('X-Turnstile-Token');
    if (!token || token.length > 2048) return reply({ error: 'Please complete the verification again.' }, 403);
    try {
        const ip = request.headers.get('CF-Connecting-IP');
        if (!ip && !LOCAL_HOSTS.has(url.hostname)) return reply({ error: 'Unable to verify this request.' }, 403);
        const limit = await env.DRAWINGS_RATE_LIMITER.limit({ key: `drawing:${ip || 'local'}` });
        if (!limit.success) return reply({ error: 'Too many submissions. Please wait a minute before trying again.' }, 429, { 'Retry-After': '60' });
        const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
        if (ip) form.set('remoteip', ip);
        const response = await (dependencies.fetch || fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body: form, signal: AbortSignal.timeout(8000),
        });
        const verification = await response.json();
        const localTest = LOCAL_HOSTS.has(url.hostname) && env.TURNSTILE_SECRET_KEY === TEST_SECRET;
        if (!response.ok || !verification.success || (!localTest && (verification.hostname !== url.hostname || verification.action !== 'draw-sumn'))) {
            return reply({ error: 'Verification failed. Please verify again; your drawing is still here.' }, 403);
        }
        const bytes = await readLimited(request);
        if (!bytes) return reply({ error: 'Drawing is too large or empty.' }, 413);
        if (!validDrawing(bytes)) return reply({ error: 'Please send an 800 × 500 PNG from the drawing canvas.' }, 400);
        const id = crypto.randomUUID();
        const date = new Date().toISOString();
        await env.DRAWINGS.put(`drawings/${date.slice(0, 10)}/${id}.png`, bytes, {
            httpMetadata: { contentType: 'image/png', cacheControl: 'private, no-store' },
            customMetadata: { submittedAt: date },
        });
        return reply({ sent: true, id }, 201);
    } catch {
        return reply({ error: 'Could not confirm delivery. Your drawing is still here; retrying may send a duplicate.' }, 503);
    }
}
