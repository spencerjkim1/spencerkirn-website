import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlaylistTracks, normalizeTracks, PLAYLIST_ID, syncSpotify } from './sync-spotify.mjs';

function entry(name, addedAt, extra = {}) {
    return { added_at: addedAt, item: { id: name, name, type: 'track', artists: [{ name: 'An artist' }], ...extra } };
}

test('sorts by date added, not release date or original playlist order', () => {
    const tracks = normalizeTracks([
        entry('middle', '2026-03-01'),
        entry('old', '2025-01-01'),
        entry('new', '2026-06-01'),
    ]);
    assert.deepEqual(tracks.map((track) => track.name), ['new', 'middle', 'old']);
    assert.equal(tracks[0].url, 'https://open.spotify.com/track/new');
});

test('preserves duplicates, reverses equal-date additions, places unknown dates last', () => {
    const tracks = normalizeTracks([
        entry('unknown', null),
        entry('same', '2026-01-01'),
        entry('same', '2026-01-01'),
    ]);
    assert.deepEqual(tracks.map((track) => track.position), [2, 1, 0]);
});

test('ignores removed, local, and non-song items; accepts legacy track property', () => {
    const legacy = entry('legacy', '2026-01-01');
    legacy.track = legacy.item;
    delete legacy.item;
    const tracks = normalizeTracks([
        { item: null },
        entry('local', null, { is_local: true }),
        entry('episode', null, { type: 'episode' }),
        legacy,
    ]);
    assert.deepEqual(tracks.map((track) => track.name), ['legacy']);
});

test('fetches every page before sorting, including newest additions on the last page', async () => {
    let calls = 0;
    const next = `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/items?offset=50&limit=50`;
    const fetcher = async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        calls++;
        if (calls === 1) return Response.json({ items: [entry('old', '2025-01-01')], next });
        assert.equal(url, next);
        return Response.json({ items: [entry('new', '2026-01-01')], next: null });
    };
    const tracks = await getPlaylistTracks('test-token', fetcher);
    assert.equal(calls, 2);
    assert.deepEqual(tracks.map((track) => track.name), ['new', 'old']);
});

test('never forwards the token to an unexpected pagination URL', async () => {
    let calls = 0;
    await assert.rejects(getPlaylistTracks('secret', async () => {
        calls++;
        return Response.json({ items: [], next: 'https://example.com/steal-token' });
    }), /Unexpected Spotify pagination/);
    assert.equal(calls, 1);
});

test('detects pagination loops', async () => {
    await assert.rejects(getPlaylistTracks('token', async (url) => Response.json({ items: [], next: url })), /Unexpected Spotify pagination/);
});

test('fails safely on API errors and missing credentials', async () => {
    await assert.rejects(getPlaylistTracks('secret', async () => new Response('private details', { status: 403 })), /Spotify request failed \(403\)/);
    await assert.rejects(syncSpotify({}), /Set SPOTIFY_CLIENT_ID/);
});
