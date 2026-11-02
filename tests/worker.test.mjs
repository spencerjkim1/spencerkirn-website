import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const executionContext = { waitUntil() {} };

test('Worker routes Spotify requests to the server handler', async () => {
    const response = await worker.fetch(new Request('https://spencerkirn.com/api/spotify'), {}, executionContext);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'not-configured');
});

test('Worker API rejects unsupported methods and unknown endpoints', async () => {
    const post = await worker.fetch(new Request('https://spencerkirn.com/api/spotify', { method: 'POST' }), {}, executionContext);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');
    const unknown = await worker.fetch(new Request('https://spencerkirn.com/api/unknown'), {}, executionContext);
    assert.equal(unknown.status, 404);
});

test('non-API requests use only the prepared public assets binding', async () => {
    const response = await worker.fetch(new Request('https://spencerkirn.com/demo'), {
        ASSETS: { fetch: async (request) => new Response(`Public asset: ${new URL(request.url).pathname}`) },
    }, executionContext);
    assert.equal(await response.text(), 'Public asset: /demo');
});
