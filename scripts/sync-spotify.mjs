import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const PLAYLIST_ID = '1CQm2Hmuu6sIQ8N3wVWwXw';
const output = new URL('../data/allma.json', import.meta.url);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function request(url, options, fetcher) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(30_000) });
        if (response.ok) return response.json();
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
            const delay = Number(response.headers.get('retry-after')) || 2 ** attempt;
            if (delay > 60) throw new Error('Spotify rate limit: try the sync again later.');
            await pause(Math.max(1, delay) * 1000);
            continue;
        }
        // Do not include request/response bodies, which may contain credentials.
        throw new Error(`Spotify request failed (${response.status}). Check app access and credentials.`);
    }
}

export function normalizeTracks(items) {
    return items.map((entry, position) => {
        const track = entry.item ?? entry.track;
        if (!track || track.type !== 'track' || entry.is_local || track.is_local || !track.id || !track.name) return null;
        return {
            name: track.name,
            artists: (track.artists ?? []).map((artist) => artist.name),
            url: `https://open.spotify.com/track/${track.id}`,
            addedAt: entry.added_at ?? null,
            position,
        };
    }).filter(Boolean).sort((a, b) => (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || b.position - a.position);
}

export async function getPlaylistTracks(accessToken, fetcher = fetch) {
    const items = [];
    let next = `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/items?limit=50`;
    const visited = new Set();
    while (next) {
        const url = new URL(next);
        if (url.origin !== 'https://api.spotify.com' || url.pathname !== `/v1/playlists/${PLAYLIST_ID}/items` || visited.has(url.href)) {
            throw new Error('Unexpected Spotify pagination URL.');
        }
        visited.add(url.href);
        const page = await request(url.href, { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher);
        if (!Array.isArray(page.items)) throw new Error('Spotify returned invalid playlist data.');
        items.push(...page.items);
        next = page.next;
    }
    return normalizeTracks(items);
}

export async function syncSpotify(env = process.env, fetcher = fetch) {
    const names = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN'];
    if (names.some((name) => !env[name])) throw new Error(`Set ${names.join(', ')} before syncing.`);
    const token = await request('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN }),
    }, fetcher);
    if (!token.access_token) throw new Error('Spotify did not return an access token.');
    if (token.refresh_token && token.refresh_token !== env.SPOTIFY_REFRESH_TOKEN) {
        throw new Error('Spotify rotated the refresh token. Re-authorize and update SPOTIFY_REFRESH_TOKEN before retrying.');
    }
    const tracks = await getPlaylistTracks(token.access_token, fetcher);
    let previous;
    try { previous = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (JSON.stringify(previous?.tracks) === JSON.stringify(tracks)) {
        console.log('allma is already up to date.');
        return;
    }
    await mkdir(new URL('../data/', import.meta.url), { recursive: true });
    await writeFile(output, `${JSON.stringify({ playlistId: PLAYLIST_ID, updatedAt: new Date().toISOString(), tracks }, null, 2)}\n`);
    console.log(`Updated allma: ${tracks.length} songs, newest additions first.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    syncSpotify().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
