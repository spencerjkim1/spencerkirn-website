import { getListeningActivity } from '../lib/spotify.js';
import { browserResponse } from './browser-response.js';

// Only normalized public display data is cached. OAuth tokens never leave this function.
export async function handleSpotify(context) {
    const cache = globalThis.caches?.default;
    // Version the internal key so older cache policies cannot survive this fix.
    const key = new Request(`${new URL(context.request.url).origin}/api/spotify?cache=v2`);
    const cached = await cache?.match(key);
    if (cached) return browserResponse(cached);
    try {
        const activity = await getListeningActivity(context.env);
        const response = Response.json(activity, { headers: {
            // This policy is only for the explicit Cache API copy, never browsers/CDNs.
            'Cache-Control': activity.status === 'connected' ? 'public, max-age=30' : 'no-store',
            'X-Content-Type-Options': 'nosniff',
        } });
        if (cache && activity.status === 'connected') context.waitUntil(cache.put(key, response.clone()));
        return browserResponse(response);
    } catch {
        return browserResponse(Response.json({ status: 'unavailable', current: null, recent: [] }, {
            status: 503,
            headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        }));
    }
}
