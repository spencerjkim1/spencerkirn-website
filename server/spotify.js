import { getListeningActivity } from '../lib/spotify.js';

// Only normalized public display data is cached. OAuth tokens never leave this function.
export async function handleSpotify(context) {
    const cache = globalThis.caches?.default;
    const key = new Request(`${new URL(context.request.url).origin}/api/spotify`);
    const cached = await cache?.match(key);
    if (cached) return cached;
    try {
        const activity = await getListeningActivity(context.env);
        const response = Response.json(activity, { headers: {
            'Cache-Control': activity.status === 'connected' ? 'public, max-age=0, s-maxage=30' : 'no-store',
            'X-Content-Type-Options': 'nosniff',
        } });
        if (cache && activity.status === 'connected') context.waitUntil(cache.put(key, response.clone()));
        return response;
    } catch {
        return Response.json({ status: 'unavailable', current: null, recent: [] }, {
            status: 503,
            headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        });
    }
}
