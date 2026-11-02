import { browserResponse } from './browser-response.js';

export async function handleLetterboxd(context) {
    const cache = globalThis.caches?.default;
    const key = new Request(`${new URL(context.request.url).origin}/api/letterboxd?cache=v2`);
    const cached = await cache?.match(key);
    if (cached) return browserResponse(cached);
    try {
        // Fixed public feed, not an arbitrary URL proxy. No Letterboxd login required.
        const upstream = await fetch('https://letterboxd.com/spencerjkim/rss/', {
            headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!upstream.ok) throw new Error('Feed unavailable');
        const xml = await upstream.text();
        if (!xml.includes('<rss')) throw new Error('Invalid feed');
        const response = new Response(xml, { headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
            'X-Content-Type-Options': 'nosniff',
        } });
        if (cache) context.waitUntil(cache.put(key, response.clone()));
        return browserResponse(response);
    } catch {
        return browserResponse(Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }));
    }
}
