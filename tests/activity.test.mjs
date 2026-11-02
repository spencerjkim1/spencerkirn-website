import test from 'node:test';
import assert from 'node:assert/strict';
import { getListeningActivity, getRecentHistory, normalizeRecent, normalizeTrack } from '../lib/spotify.js';
import { handleSpotify as spotifyEndpoint } from '../server/spotify.js';
import { handleLetterboxd as letterboxdEndpoint } from '../server/letterboxd.js';

const env = { SPOTIFY_CLIENT_ID: 'test-client', SPOTIFY_CLIENT_SECRET: 'test-secret', SPOTIFY_REFRESH_TOKEN: 'test-refresh' };
const song = (id = 'song') => ({ id, name: `Song ${id}`, type: 'track', artists: [{ name: 'An artist' }], album: { images: [{ url: 'https://i.scdn.co/image/test' }] }, private_field: 'not-for-public-output' });
const event = (id, date) => ({ track: song(id), played_at: date });
const context = (bindings = {}) => ({ env: bindings, request: new Request('https://example.com/api/spotify'), waitUntil() {} });

function mockSpotify(playing, recent, currentStatus = 200, recentStatus = 200) {
    return async (url, options) => {
        if (url === 'https://accounts.spotify.com/api/token') {
            assert.equal(options.method, 'POST');
            assert.equal(options.body.get('grant_type'), 'refresh_token');
            assert.equal(options.body.get('refresh_token'), env.SPOTIFY_REFRESH_TOKEN);
            return Response.json({ access_token: 'private-access-token' });
        }
        assert.equal(options.headers.Authorization, 'Bearer private-access-token');
        if (url.endsWith('/currently-playing')) return currentStatus === 204 ? new Response(null, { status: 204 }) : Response.json(playing, { status: currentStatus });
        assert.ok(url.endsWith('/recently-played?limit=50'));
        return Response.json({ items: recent }, { status: recentStatus });
    };
}

test('unconfigured activity does not call Spotify', async () => {
    assert.deepEqual(await getListeningActivity({}, () => assert.fail('Unexpected network call')), { status: 'not-configured', current: null, recent: [] });
});

test('normalization exposes only required display metadata', () => {
    const track = normalizeTrack(song());
    assert.deepEqual(Object.keys(track), ['name', 'artists', 'url', 'image']);
    assert.equal(track.url, 'https://open.spotify.com/track/song');
    assert.equal(normalizeTrack(null), null);
    assert.equal(normalizeTrack({ ...song(), is_local: true }), null);
    assert.equal(normalizeTrack({ ...song(), type: 'episode' }), null);
});

test('history is newest-first, capped at 100, preserving repeat plays', () => {
    const events = Array.from({ length: 125 }, (_, i) => event('same-song', new Date(Date.UTC(2026, 0, i + 1)).toISOString()));
    events.push(event('invalid-date', 'nope'), { track: null, played_at: '2026-01-30' });
    const tracks = normalizeRecent(events);
    assert.equal(tracks.length, 100);
    assert.equal(tracks[0].playedAt, '2026-05-05T00:00:00.000Z');
    assert.equal(new Set(tracks.map((track) => track.url)).size, 1);
});

test('playing state and recent history are returned without tokens or raw private fields', async () => {
    const data = await getListeningActivity(env, mockSpotify({ is_playing: true, item: song() }, [event('recent', '2026-11-02T12:00:00Z')]));
    assert.equal(data.current.isPlaying, true);
    assert.equal(data.currentStatus, 'ok');
    assert.equal(data.recent.length, 1);
    assert.doesNotMatch(JSON.stringify(data), /private-access-token|test-secret|test-refresh|private_field/);
});

test('paused and idle states are distinct', async () => {
    const paused = await getListeningActivity(env, mockSpotify({ is_playing: false, item: song() }, []));
    assert.equal(paused.current.isPlaying, false);
    const idle = await getListeningActivity(env, mockSpotify(null, [], 204));
    assert.equal(idle.current, null);
    assert.equal(idle.currentStatus, 'ok');
});

test('playback errors do not hide valid history or claim the user is idle', async () => {
    const data = await getListeningActivity(env, mockSpotify({}, [event('recent', '2026-11-02T12:00:00Z')], 403));
    assert.equal(data.currentStatus, 'unavailable');
    assert.equal(data.current, null);
    assert.equal(data.recentStatus, 'ok');
    assert.equal(data.recent.length, 1);
});

test('history errors do not hide valid current playback', async () => {
    const data = await getListeningActivity(env, mockSpotify({ is_playing: true, item: song() }, [], 200, 429));
    assert.equal(data.current.isPlaying, true);
    assert.equal(data.recentStatus, 'unavailable');
});

test('token failures produce a sanitized, non-cacheable API error', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('sensitive details', { status: 401 }));
    const response = await spotifyEndpoint(context(env));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /sensitive|test-secret|test-refresh/);
});

test('unconfigured API response is not cached', async () => {
    const response = await spotifyEndpoint(context());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).status, 'not-configured');
});

test('Letterboxd proxy uses a fixed public feed and XML content type', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url) => {
        assert.equal(url, 'https://letterboxd.com/spencerjkim/rss/');
        return new Response('<?xml version="1.0"?><rss><channel/></rss>');
    });
    const response = await letterboxdEndpoint(context());
    assert.match(response.headers.get('content-type'), /application\/xml/);
    assert.match(response.headers.get('cache-control'), /s-maxage=300/);
});

test('history fetches a second page with an exclusive before cursor for up to 100 plays', async () => {
    const events = Array.from({ length: 100 }, (_, i) => event(`song-${i}`, new Date(Date.UTC(2026, 0, i + 1)).toISOString())).reverse();
    const calls = [];
    const history = await getRecentHistory(async (path) => {
        calls.push(path);
        return { items: calls.length === 1 ? events.slice(0, 50) : events.slice(50) };
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1], `recently-played?limit=50&before=${Date.parse(events[49].played_at)}`);
    const tracks = normalizeRecent(history.items);
    assert.equal(tracks.length, 100);
    assert.equal(tracks[0].name, 'Song song-99');
    assert.equal(tracks[99].name, 'Song song-0');
});

test('history does not claim 100 plays when Spotify returns fewer', async () => {
    let calls = 0;
    const history = await getRecentHistory(async () => {
        calls++;
        return { items: [event('one', '2026-11-02T12:00:00Z')] };
    });
    assert.equal(calls, 1);
    assert.equal(history.items.length, 1);
});

test('an older-page error preserves the latest page with a partial status', async () => {
    const events = Array.from({ length: 50 }, (_, i) => event('repeat-song', new Date(Date.UTC(2026, 0, i + 1)).toISOString()));
    let calls = 0;
    const history = await getRecentHistory(async () => {
        if (++calls === 2) throw new Error('Rate limited');
        return { items: events };
    });
    assert.equal(history.partial, true);
    assert.equal(history.items.length, 50);
});

test('ignored cursors cannot duplicate the newest page to fabricate 100 plays', async () => {
    const events = Array.from({ length: 50 }, (_, i) => event('repeat-song', new Date(Date.UTC(2026, 0, i + 1)).toISOString()));
    const history = await getRecentHistory(async () => ({ items: events }));
    assert.equal(history.items.length, 50);
    assert.equal(normalizeRecent([...events, ...events]).length, 50);
});

test('Letterboxd errors return a graceful non-cacheable response', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('Blocked', { status: 403 }));
    const response = await letterboxdEndpoint(context());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
});
