import { handleSpotify } from './server/spotify.js';
import { handleLetterboxd } from './server/letterboxd.js';

export default {
    async fetch(request, env, executionContext) {
        const path = new URL(request.url).pathname;
        const handler = path === '/api/spotify' ? handleSpotify : path === '/api/letterboxd' ? handleLetterboxd : null;
        if (handler) {
            if (request.method !== 'GET') {
                return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });
            }
            return handler({ request, env, waitUntil: (promise) => executionContext.waitUntil(promise) });
        }
        if (path.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 });
        return env.ASSETS.fetch(request);
    },
};
