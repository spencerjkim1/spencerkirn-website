export function normalizeTrack(track) {
    if (!track || track.type !== 'track' || track.is_local || !track.id || !track.name) return null;
    return {
        name: track.name,
        artists: (track.artists ?? []).map((artist) => artist.name),
        url: `https://open.spotify.com/track/${encodeURIComponent(track.id)}`,
        image: track.album?.images?.[0]?.url ?? null,
    };
}

export function normalizeRecent(items) {
    const seen = new Set();
    return (items ?? []).map((entry) => {
        const track = normalizeTrack(entry.track);
        return track && Number.isFinite(Date.parse(entry.played_at)) ? { ...track, playedAt: entry.played_at } : null;
    }).filter((track) => {
        if (!track) return false;
        const key = `${track.url}|${Date.parse(track.playedAt)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt)).slice(0, 100);
}

export async function getRecentHistory(read) {
    // Spotify allows at most 50 events per request. Ask for one older page,
    // but do not promise 100: Spotify may expose a shorter recent-history window.
    const first = await read('recently-played?limit=50');
    if (first && !Array.isArray(first.items)) throw new Error('Invalid Spotify history');
    const items = (first?.items ?? []).slice(0, 50);
    const timestamps = items.map((item) => Date.parse(item.played_at)).filter(Number.isFinite);
    if (items.length < 50 || !timestamps.length) return { items, partial: false };
    const oldest = Math.min(...timestamps);
    try {
        const older = await read(`recently-played?limit=50&before=${oldest}`);
        if (older && !Array.isArray(older.items)) throw new Error('Invalid Spotify history');
        // Ignore overlaps if Spotify repeats the first page or ignores its cursor.
        const additional = (older?.items ?? []).filter((item) => Date.parse(item.played_at) < oldest).slice(0, 50);
        return { items: [...items, ...additional], partial: false };
    } catch {
        // An older-page failure should not hide the latest 50 valid plays.
        return { items, partial: true };
    }
}

export async function getListeningActivity(env, fetcher = fetch) {
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_REFRESH_TOKEN) {
        return { status: 'not-configured', current: null, recent: [] };
    }
    const tokenResponse = await fetcher('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error('Spotify authorization unavailable');
    const token = await tokenResponse.json();
    if (!token.access_token) throw new Error('Spotify authorization unavailable');

    async function read(path) {
        const response = await fetcher(`https://api.spotify.com/v1/me/player/${path}`, {
            headers: { Authorization: `Bearer ${token.access_token}` },
            signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 204) return null;
        if (!response.ok) throw new Error('Spotify activity unavailable');
        return response.json();
    }
    const [playing, history] = await Promise.allSettled([
        read('currently-playing'),
        getRecentHistory(read),
    ]);
    const currentData = playing.status === 'fulfilled' ? playing.value : null;
    const track = normalizeTrack(currentData?.item);
    return {
        status: 'connected',
        currentStatus: playing.status === 'fulfilled' ? 'ok' : 'unavailable',
        recentStatus: history.status === 'fulfilled' ? (history.value.partial ? 'partial' : 'ok') : 'unavailable',
        current: track ? { ...track, isPlaying: currentData.is_playing === true } : null,
        recent: history.status === 'fulfilled' ? normalizeRecent(history.value?.items) : [],
        checkedAt: new Date().toISOString(),
    };
}
