import { createOrders, DATASETS } from '../assets/order-data.js';
import { cleanOrders } from '../assets/clean-orders.js';

const MAX_BODY_BYTES = 1024;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });

export function processOrders(input) {
    const valid = [];
    const rejected = [];
    const categories = new Map();
    for (const [index, row] of input.entries()) {
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        let reason;
        if (!/^[-A-Z0-9]{1,40}$/.test(id)) reason = 'Missing or invalid order ID';
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`)) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date) reason = 'Invalid calendar date';
        else if (typeof row.amount !== 'string' || !/^\d{1,7}\.\d{2}$/.test(row.amount)) reason = 'Invalid USD amount';
        else if (typeof row.currency !== 'string' || row.currency.toUpperCase() !== 'USD') reason = 'Unsupported currency';
        else if (typeof row.category !== 'string' || !['software', 'hardware', 'services'].includes(row.category.trim().toLowerCase())) reason = 'Unknown category';
        if (reason) {
            rejected.push({ row: index + 1, reason });
            continue;
        }
        valid.push(row);
    }
    const rows = cleanOrders(valid);
    const duplicates = valid.length - rows.length;
    for (const { category, amountCents } of rows) {
        const group = categories.get(category) || { category, orders: 0, revenueCents: 0 };
        group.orders += 1;
        group.revenueCents += amountCents;
        categories.set(category, group);
    }
    return {
        summary: { input: input.length, accepted: rows.length, duplicates, rejected: rejected.length, redacted: rows.length, revenueCents: rows.reduce((total, row) => total + row.amountCents, 0), currency: 'USD' },
        categories: [...categories.values()].sort((a, b) => b.revenueCents - a.revenueCents),
        rows, rejected,
    };
}

export async function handleOrderProcessing({ request, env }) {
    if (request.method !== 'POST') return json({ error: 'Use POST to process a sample.' }, 405, { Allow: 'POST' });
    const url = new URL(request.url);
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Use the Data Lab on this site.' }, 403);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'Expected JSON.' }, 415);
    if (!env.DATA_LAB_RATE_LIMITER) return json({ error: 'Data Lab is temporarily unavailable.' }, 503);
    try {
        const limit = await env.DATA_LAB_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local-preview' });
        if (!limit.success) return json({ error: 'Please wait a minute before processing another sample.' }, 429, { 'Retry-After': '60' });
        const reader = request.body?.getReader();
        if (!reader) return json({ error: 'Choose a sample dataset.' }, 400);
        let size = 0;
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY_BYTES) { await reader.cancel(); return json({ error: 'Request is too large.' }, 413); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { return json({ error: 'Expected valid JSON.' }, 400); }
        if (!body || Array.isArray(body) || typeof body.dataset !== 'string' || !Object.hasOwn(DATASETS, body.dataset) || Object.keys(body).length !== 1) return json({ error: 'Choose one of the provided synthetic datasets.' }, 400);
        const started = performance.now();
        const result = processOrders(createOrders(body.dataset));
        const processingMs = Math.round((performance.now() - started) * 100) / 100;
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        return json({ ...result, execution: { processingMs, colo: local ? null : request.cf?.colo || null, runtime: local ? 'Local Workers runtime' : 'Cloudflare Worker', persisted: false } });
    } catch {
        return json({ error: 'Could not process this sample. Please try again.' }, 503);
    }
}
