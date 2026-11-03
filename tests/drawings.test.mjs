import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { handleDrawings, validDrawing } from '../server/drawings.js';
import worker from '../worker.js';

function chunk(type, body = Buffer.alloc(0)) {
    const data = Buffer.concat([Buffer.from(type), body]);
    let crc = 0xffffffff;
    for (const value of data) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, data, checksum]);
}

function png(width = 800, colorChunks = []) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(500, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...colorChunks,
        chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * 500))), chunk('IEND'),
    ]);
}

function setup(overrides = {}) {
    const stored = [];
    let validations = 0;
    const env = {
        DRAWINGS_ENABLED: 'true', TURNSTILE_SITE_KEY: 'public-site-key', TURNSTILE_SECRET_KEY: 'private-secret',
        DRAWINGS_RATE_LIMITER: { limit: async () => ({ success: true }) },
        DRAWINGS: { put: async (...args) => { stored.push(args); } },
        ...overrides,
    };
    const dependencies = { fetch: async () => {
        validations++;
        return Response.json({ success: true, hostname: 'spencerkirn.com', action: 'draw-sumn' });
    } };
    return { env, dependencies, stored, get validations() { return validations; } };
}

function request({ method = 'POST', body = png(), headers = {}, url = 'https://spencerkirn.com/api/drawings' } = {}) {
    return new Request(url, { method, headers: {
        Origin: new URL(url).origin, 'Content-Type': 'image/png', 'X-Turnstile-Token': 'token', 'CF-Connecting-IP': '192.0.2.1', ...headers,
    }, ...(method === 'GET' ? {} : { body }) });
}

test('drawing configuration is no-store and never exposes secrets or private storage', async () => {
    const s = setup();
    const response = await handleDrawings({ request: request({ method: 'GET' }), env: s.env });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { enabled: true, sitekey: 'public-site-key', maxBytes: 1048576 });
});

test('drawing API fails closed until all bindings, secrets and enable flag exist', async () => {
    for (const field of ['DRAWINGS', 'DRAWINGS_RATE_LIMITER', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'DRAWINGS_ENABLED']) {
        const s = setup({ [field]: undefined });
        const response = await handleDrawings({ request: request(), env: s.env }, s.dependencies);
        assert.equal(response.status, 503);
        assert.equal(s.stored.length, 0);
    }
});

test('test Turnstile keys cannot enable production submissions', async () => {
    const s = setup({ TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' });
    assert.equal((await handleDrawings({ request: request(), env: s.env }, s.dependencies)).status, 503);
    const local = await handleDrawings({ request: request({ method: 'GET', url: 'http://localhost:8081/api/drawings' }), env: s.env });
    assert.equal((await local.json()).enabled, true);
});

test('drawing is stored privately only after validation with random filename and no IP metadata', async () => {
    const s = setup();
    const response = await handleDrawings({ request: request(), env: s.env }, s.dependencies);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).sent, true);
    assert.equal(s.validations, 1);
    assert.equal(s.stored.length, 1);
    const [key, bytes, options] = s.stored[0];
    assert.match(key, /^drawings\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.png$/);
    assert.deepEqual(bytes, new Uint8Array(png()));
    assert.equal(options.httpMetadata.cacheControl, 'private, no-store');
    assert.deepEqual(Object.keys(options.customMetadata), ['submittedAt']);
});

test('cross-origin, missing-origin and unsupported content types are rejected before verification', async () => {
    for (const [headers, expected] of [[{ Origin: 'https://evil.example' }, 403], [{ Origin: '' }, 403], [{ 'Content-Type': 'image/svg+xml' }, 415], [{ 'X-Turnstile-Token': '' }, 403]]) {
        const s = setup();
        const response = await handleDrawings({ request: request({ headers }), env: s.env }, s.dependencies);
        assert.equal(response.status, expected);
        assert.equal(s.validations, 0);
        assert.equal(s.stored.length, 0);
    }
});

test('rate-limited requests never call Turnstile or R2', async () => {
    const s = setup({ DRAWINGS_RATE_LIMITER: { limit: async () => ({ success: false }) } });
    const response = await handleDrawings({ request: request(), env: s.env }, s.dependencies);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(s.validations, 0);
    assert.equal(s.stored.length, 0);
});

test('Turnstile rejects failure, wrong hostname and wrong action', async () => {
    for (const result of [{ success: false }, { success: true, hostname: 'evil.example', action: 'draw-sumn' }, { success: true, hostname: 'spencerkirn.com', action: 'other' }]) {
        const s = setup();
        const response = await handleDrawings({ request: request(), env: s.env }, { fetch: async () => Response.json(result) });
        assert.equal(response.status, 403);
        assert.equal(s.stored.length, 0);
    }
});

test('drawing upload checks actual bytes, not only Content-Length', async () => {
    const s = setup();
    const response = await handleDrawings({ request: request({ body: Buffer.alloc(1048577), headers: { 'Content-Length': '1' } }), env: s.env }, s.dependencies);
    assert.equal(response.status, 413);
    assert.equal(s.stored.length, 0);
});

test('PNG checks reject forged files, wrong dimensions, broken CRCs, truncation and trailing bytes', () => {
    assert.equal(validDrawing(png()), true);
    const corrupt = png();
    corrupt[45] ^= 1;
    for (const bytes of [Buffer.from('<svg/>'), png(801), corrupt, png().subarray(0, -1), Buffer.concat([png(), Buffer.from('extra')])]) {
        assert.equal(validDrawing(bytes), false);
    }
});

test('invalid drawings do not reach R2', async () => {
    const s = setup();
    const response = await handleDrawings({ request: request({ body: 'not a PNG' }), env: s.env }, s.dependencies);
    assert.equal(response.status, 400);
    const message = (await response.json()).error;
    assert.doesNotMatch(message, /800|500|PNG/);
    assert.match(message, /not been sent/);
    assert.equal(s.stored.length, 0);
});

test('browser PNGs with ICC color-profile metadata reach R2', async () => {
    const profile = chunk('iCCP', Buffer.concat([Buffer.from('Display P3\0\0'), deflateSync(Buffer.alloc(128))]));
    const body = png(800, [profile]);
    assert.equal(validDrawing(body), true);
    const s = setup();
    const response = await handleDrawings({ request: request({ body }), env: s.env }, s.dependencies);
    assert.equal(response.status, 201);
    assert.equal(s.stored.length, 1);
});

test('additional browser color metadata remains subject to CRC, geometry and chunk checks', () => {
    const color = chunk('cICP', Buffer.from([12, 13, 0, 1]));
    const bits = chunk('sBIT', Buffer.from([8, 8, 8, 8]));
    assert.equal(validDrawing(png(800, [color, bits])), true);
    assert.equal(validDrawing(png(801, [color])), false);
    const broken = png(800, [color]);
    broken[45] ^= 1;
    assert.equal(validDrawing(broken), false);
    assert.equal(validDrawing(png(800, [chunk('acTL', Buffer.alloc(8))])), false);
});

test('Turnstile uses a horizontal flexible widget rather than compact mobile mode', async () => {
    const script = await readFile(new URL('../assets/draw.js', import.meta.url), 'utf8');
    assert.match(script, /size: 'flexible'/);
    assert.doesNotMatch(script, /'compact'/);
});

test('storage failures are sanitized and do not falsely confirm delivery', async () => {
    const s = setup({ DRAWINGS: { put: async () => { throw new Error('private-storage-details'); } } });
    const response = await handleDrawings({ request: request(), env: s.env }, s.dependencies);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private-storage-details|private-secret/);
});

test('Worker routes drawing API and never exposes a drawings listing or read endpoint', async () => {
    const config = await worker.fetch(request({ method: 'GET' }), {}, {});
    assert.deepEqual(await config.json(), { enabled: false });
    const invalidMethod = await worker.fetch(request({ method: 'DELETE' }), {}, {});
    assert.equal(invalidMethod.status, 405);
    assert.equal(invalidMethod.headers.get('allow'), 'GET, POST');
    const privateFile = await worker.fetch(new Request('https://spencerkirn.com/api/drawings/example.png'), {}, {});
    assert.equal(privateFile.status, 404);
});

test('Draw Me Sumn sits between Letterboxd and Demos and uses a fixed mobile-friendly canvas', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.ok(html.indexOf('<section id="letterboxd"') < html.indexOf('<section id="draw"'));
    assert.ok(html.indexOf('<section id="draw"') < html.indexOf('<section id="demo"'));
    assert.match(html, /href="#draw">Draw Me Sumn <span>03/);
    assert.match(html, /id="draw-heading">DRAW ME SUMN</);
    assert.match(html, /id="draw-instructions" class="playlist-note">draw me a lil sumn\.</);
    assert.match(html, /id="draw-privacy" class="playlist-note">sent privately</);
    assert.match(html, /href="#demo">Demos <span>04/);
    assert.match(html, /id="draw-canvas" width="800" height="500"/);
});
