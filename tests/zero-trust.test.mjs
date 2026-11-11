import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { gatewayDecision, GATEWAY_EXAMPLES } from '../assets/zero-trust-model.js';
import { APP_HOST, createAccessApp, escapeHTML } from '../access-app/worker.js';

const env = { ACCESS_TEAM_DOMAIN: 'spencerjkim.cloudflareaccess.com', ACCESS_AUD: 'test-app-audience' };
const { privateKey, publicKey } = await generateKeyPair('RS256');
const keySet = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test', alg: 'RS256' }] });
const app = createAccessApp(keySet);
async function sign(overrides = {}, key = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email: 'alex@example.com', sub: 'test-user', iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD, iat: now, exp: now + 300, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(key);
}
function request(token, path = '/', options = {}) {
    return new Request(`https://${APP_HOST}${path}`, { ...options, headers: token ? { 'Cf-Access-Jwt-Assertion': token, ...options.headers } : options.headers });
}

test('Access Worker fails closed for missing configuration, token, fake identity and alternate hosts', async () => {
    assert.equal((await app.fetch(request(), env)).status, 401);
    assert.equal((await app.fetch(request(null, '/', { headers: { 'Cf-Access-Authenticated-User-Email': 'fake@example.com' } }), env)).status, 401);
    assert.equal((await app.fetch(request('fake-token'), env)).status, 401);
    assert.equal((await app.fetch(request('x'.repeat(16385)), env)).status, 401);
    assert.equal((await app.fetch(request(), {})).status, 503);
    assert.equal((await app.fetch(new Request('https://spencerkirn-access-demo.example.workers.dev/'), env)).status, 404);
    assert.equal((await app.fetch(new Request(`http://${APP_HOST}/`), env)).status, 404);
});

test('Access Worker rejects wrong signature, issuer, audience, expiry and missing claims', async () => {
    const other = await generateKeyPair('RS256');
    const now = Math.floor(Date.now() / 1000);
    const tokens = [await sign({}, other.privateKey), await sign({ iss: 'https://wrong.cloudflareaccess.com' }), await sign({ aud: 'another-app' }), await sign({ exp: now - 60 }), await sign({ exp: undefined }), await sign({ sub: undefined }), await sign({ iat: undefined }), await sign({ email: undefined }), await sign({ email: 123 })];
    for (const token of tokens) {
        const response = await app.fetch(request(token), env);
        assert.equal(response.status, 401);
        assert.match(response.headers.get('Cache-Control'), /no-store/);
        assert.doesNotMatch(await response.text(), /alex@example.com|Team Space/);
    }
});

test('valid Access token opens a non-cacheable app with a safely escaped verified identity', async () => {
    const response = await app.fetch(request(await sign()), env);
    assert.equal(response.status, 200);
    for (const header of ['Cache-Control', 'CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control']) assert.match(response.headers.get(header), /no-store/);
    assert.match(response.headers.get('Content-Security-Policy'), /default-src 'none'.*frame-ancestors 'none'/);
    const html = await response.text();
    assert.match(html, /alex@example.com/);
    assert.match(html, /cdn-cgi\/access\/logout/);
    assert.match(html, /Project Northstar/);
    assert.doesNotMatch(html, /<script|localStorage|fetch\(/);
    const injected = await app.fetch(request(await sign({ email: '<script>alert(1)</script>@example.com' })), env);
    const body = await injected.text();
    assert.doesNotMatch(body, /<script>/);
    assert.match(body, /&lt;script&gt;/);
    assert.equal(escapeHTML('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

test('authenticated app supports only GET/HEAD at its root', async () => {
    const token = await sign();
    const head = await app.fetch(request(token, '/', { method: 'HEAD' }), env);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await app.fetch(request(token, '/unknown'), env)).status, 404);
    assert.equal((await app.fetch(request(token, '/', { method: 'POST' }), env)).status, 405);
});

test('Access is separate from the public site and alternate Worker URLs are disabled', async () => {
    const config = JSON.parse(await readFile(new URL('../access-app/wrangler.jsonc', import.meta.url), 'utf8'));
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.deepEqual(config.routes, [{ pattern: APP_HOST, custom_domain: true }]);
    assert.match(config.vars.ACCESS_AUD, /^[a-f0-9]{64}$/);
    const html = await readFile(new URL('../demo/zero-trust.html', import.meta.url), 'utf8');
    assert.match(html, /href="https:\/\/access-demo\.spencerkirn\.com\/"/);
    assert.match(html, /Cloudflare handles email delivery and authentication logs/);
    assert.match(html, /Gateway — Simulation/);
    assert.doesNotMatch(html, /<form|<input|demo-code|sample-identity|No email will be sent/);
});

test('Gateway examples remain explicit local simulations with fictional destinations', async () => {
    assert.equal(gatewayDecision('work').outcome, 'Allow');
    assert.equal(gatewayDecision('threat').outcome, 'Block');
    assert.equal(gatewayDecision('personal').outcome, 'Block');
    for (const id of Object.keys(GATEWAY_EXAMPLES)) {
        const decision = gatewayDecision(id);
        assert.equal(decision.simulated, true);
        assert.ok(decision.destination.endsWith('.invalid'));
        decision.outcome = 'changed';
        assert.notEqual(gatewayDecision(id).outcome, 'changed');
    }
    assert.throws(() => gatewayDecision('__proto__'));
    const js = await readFile(new URL('../assets/zero-trust.js', import.meta.url), 'utf8');
    assert.doesNotMatch(js, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|innerHTML/);
});
