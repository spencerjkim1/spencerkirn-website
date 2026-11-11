import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOrders, DATASETS } from '../assets/order-data.js';
import { cleanOrders } from '../assets/clean-orders.js';
import { handleOrderProcessing, processOrders } from '../server/order-processing.js';
import worker from '../worker.js';

const url = 'https://spencerkirn.com/api/demo/process';
const env = { DATA_LAB_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const request = (body = { dataset: 'sample' }, options = {}) => new Request(url, {
    method: 'POST', headers: { Origin: 'https://spencerkirn.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options,
});
const handle = (req = request(), bindings = env) => handleOrderProcessing({ request: req, env: bindings });

test('small sample yields eight clean orders and exactly $644 without mutating input', () => {
    const input = createOrders('sample');
    const original = structuredClone(input);
    const result = processOrders(input);
    assert.deepEqual(result.summary, { input: 12, accepted: 8, duplicates: 1, rejected: 3, redacted: 8, revenueCents: 64400, currency: 'USD' });
    assert.deepEqual(input, original);
    assert.equal(result.categories.reduce((sum, category) => sum + category.revenueCents, 0), 64400);
    assert.deepEqual(result.rejected.map((row) => row.reason), ['Invalid USD amount', 'Invalid calendar date', 'Missing or invalid order ID']);
    assert.ok(result.rows.every((row) => row.email === '[redacted]' && row.currency === 'USD' && row.category === row.category.trim().toLowerCase()));
    assert.ok(!JSON.stringify(result).includes('@'));
});

test('all sample sizes are bounded, deterministic and conserve record counts and revenue', () => {
    for (const [dataset, config] of Object.entries(DATASETS)) {
        const orders = createOrders(dataset);
        assert.deepEqual(orders, createOrders(dataset));
        assert.ok(orders.length <= 600);
        const { summary } = processOrders(orders);
        assert.equal(summary.input, summary.accepted + summary.duplicates + summary.rejected);
        assert.equal(summary.revenueCents, config.batches * 64400);
        assert.equal(summary.accepted, config.batches * 8);
    }
    assert.throws(() => createOrders('toString'));
});

test('money uses integer cents and dates reject calendar overflow', () => {
    const row = createOrders('sample')[0];
    const result = processOrders([{ ...row, amount: '0.10' }, { ...row, id: 'SECOND', amount: '0.20' }]);
    assert.equal(result.summary.revenueCents, 30);
    for (const amount of ['-1.00', '1e3', 'Infinity', '5.555', '99999999.00']) assert.equal(processOrders([{ ...row, amount }]).summary.rejected, 1);
    for (const date of ['2026-02-29', '2026-13-01', 'yesterday']) assert.equal(processOrders([{ ...row, date }]).summary.rejected, 1);
    assert.equal(processOrders([{ ...row, date: '2024-02-29' }]).summary.accepted, 1);
    assert.equal(processOrders([{ ...row, currency: 'EUR' }]).summary.rejected, 1);
    assert.equal(processOrders([{ ...row, category: '__proto__' }]).summary.rejected, 1);
});

test('invalid records do not displace a later valid order with the same ID', () => {
    const row = createOrders('sample')[0];
    const result = processOrders([{ ...row, amount: 'bad' }, row, row]);
    assert.equal(result.summary.accepted, 1);
    assert.equal(result.summary.rejected, 1);
    assert.equal(result.summary.duplicates, 1);
});

test('processing API routes through the Worker, is no-store, and never persists samples', async () => {
    const response = await worker.fetch(request(), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const data = await response.json();
    assert.equal(data.summary.accepted, 8);
    assert.equal(data.execution.persisted, false);
    assert.equal(data.execution.runtime, 'Cloudflare Worker');
    assert.equal(data.execution.colo, null);
    assert.equal(typeof data.execution.processingMs, 'number');
    assert.ok(!JSON.stringify(data).includes('@'));
});

test('local preview identifies local execution instead of inventing an edge location', async () => {
    const response = await handle(new Request('http://localhost:8081/api/demo/process', { method: 'POST', headers: { Origin: 'http://localhost:8081', 'Content-Type': 'application/json' }, body: '{"dataset":"sample"}' }));
    const { execution } = await response.json();
    assert.equal(execution.runtime, 'Local Workers runtime');
    assert.equal(execution.colo, null);
});

test('API rejects methods, foreign origins and non-JSON before processing', async () => {
    const get = await handle(new Request(url));
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('Allow'), 'POST');
    for (const origin of ['', 'https://elsewhere.example']) {
        assert.equal((await handle(request(undefined, { headers: { Origin: origin, 'Content-Type': 'application/json' } }))).status, 403);
    }
    assert.equal((await handle(request(undefined, { headers: { Origin: 'https://spencerkirn.com', 'Content-Type': 'text/plain' } }))).status, 415);
});

test('API only accepts sample identifiers, never uploaded records or remote URLs', async () => {
    for (const body of [null, [], {}, { dataset: 'unknown' }, { dataset: '__proto__' }, { dataset: 'sample', records: [{ email: 'private@example.com' }] }, { url: 'http://localhost/private' }]) {
        assert.equal((await handle(request(body))).status, 400);
    }
    assert.equal((await handle(request(undefined, { body: '{broken' }))).status, 400);
});

test('streamed request size is limited even without Content-Length', async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(1025))); controller.close(); } });
    assert.equal((await handle(request(undefined, { body, duplex: 'half' }))).status, 413);
});

test('rate limits fail closed and return a retry interval without exposing errors', async () => {
    assert.equal((await handle(request(), {})).status, 503);
    let key;
    const blocked = await handle(request(undefined, { headers: { Origin: 'https://spencerkirn.com', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' } }), { DATA_LAB_RATE_LIMITER: { limit: async (input) => { key = input.key; return { success: false }; } } });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('Retry-After'), '60');
    assert.equal(key, '192.0.2.1');
    const failed = await handle(request(), { DATA_LAB_RATE_LIMITER: { limit: async () => { throw new Error('PRIVATE INTERNAL ERROR'); } } });
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('PRIVATE'));
});

test('Data Lab loads scoped assets and renders returned values without HTML interpolation', async () => {
    const html = await readFile(new URL('../demo/workers.html', import.meta.url), 'utf8');
    const js = await readFile(new URL('../assets/data-lab.js', import.meta.url), 'utf8');
    assert.match(html, /data-lab\.css\?v=2/);
    assert.match(html, /data-lab\.js\?v=2/);
    assert.match(html, /role="status"/);
    assert.match(html, /not CPU billing or a benchmark/);
    assert.doesNotMatch(js, /innerHTML|eval\(/);
    assert.match(js, /AbortSignal.timeout\(15000\)/);
    assert.match(js, /response.ok/);
});

test('website shows the same core transform imported by the Worker, not a separate mock', async () => {
    const server = await readFile(new URL('../server/order-processing.js', import.meta.url), 'utf8');
    const client = await readFile(new URL('../assets/data-lab.js', import.meta.url), 'utf8');
    const source = await readFile(new URL('../assets/clean-orders.js', import.meta.url), 'utf8');
    assert.match(server, /import \{ cleanOrders \} from '\.\.\/assets\/clean-orders\.js'/);
    assert.match(server, /const rows = cleanOrders\(valid\)/);
    assert.match(client, /fetch\('\/assets\/clean-orders\.js\?v=1'/);
    assert.doesNotMatch(client, /import.*cleanOrders|eval\(|new Function/);
    assert.ok(source.includes(cleanOrders.toString()));
    const row = createOrders('sample')[0];
    assert.equal(cleanOrders([row, { ...row, id: ` ${row.id} ` }]).length, 1);
});

test('Code Deploy Run has one bounded sample and clearly separates instructions from actual execution', async () => {
    const html = await readFile(new URL('../demo/workers.html', import.meta.url), 'utf8');
    const js = await readFile(new URL('../assets/data-lab.js', import.meta.url), 'utf8');
    for (const title of ['01 / Code', '02 / Deploy', '03 / Run']) assert.ok(html.includes(title));
    assert.match(html, /Deployment instructions—not a live terminal/);
    assert.match(html, /not a complete standalone Worker/);
    assert.match(html, /No deployment has been triggered/);
    assert.match(html, /npx wrangler deploy/);
    assert.match(js, /JSON.stringify\(\{ dataset: 'large' \}\)/);
    assert.match(js, /Local preview \/ Not deployed/);
    assert.doesNotMatch(html, /<select|<table|Download CSV|Revenue by category/);
    assert.doesNotMatch(js, /fetch\([^\n]*(deploy|cloudflare\.com)/);
});
