const navLinks = [...document.querySelectorAll('.site-nav a')];
const sections = [...document.querySelectorAll('main section')];
const sectionObserver = new IntersectionObserver(() => {
    const active = [...sections].reverse().find((section) => section.getBoundingClientRect().top <= innerHeight * .35) ?? sections[0];
    navLinks.forEach((link) => {
        if (link.hash === `#${active.id}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
    });
}, { rootMargin: '-10% 0px -65% 0px' });
sections.forEach((section) => sectionObserver.observe(section));

function safeURL(value, hosts) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && hosts.includes(url.hostname) ? url.href : null;
    } catch { return null; }
}

function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

function externalLink(url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
}

let recentTracks = [];
let recentStatus = null;
function updateHistoryStatus() {
    if (!recentStatus) return;
    const limit = Number(document.querySelector('#history-limit').value);
    const shown = Math.min(limit, recentTracks.length);
    document.querySelector('#recently-played-status').textContent = recentStatus === 'unavailable'
        ? 'Listening history is temporarily unavailable.'
        : shown ? `Showing ${shown}${shown < limit ? ` of ${limit} requested` : ''} plays · Newest first · via Spotify${recentStatus === 'partial' ? ' · Older plays temporarily unavailable.' : ''}`
        : 'No recent listening history to show.';
}
function renderHistory(resetScroll = false) {
    const limit = Number(document.querySelector('#history-limit').value);
    const widget = document.querySelector('#history-widget');
    const previousScroll = widget.scrollTop;
    const rows = recentTracks.slice(0, limit).map((track, index) => {
        const item = document.createElement('li');
        const link = externalLink(track.url);
        const art = textElement('span', 'track-art', '♪');
        art.setAttribute('aria-hidden', 'true');
        const imageURL = safeURL(track.image, ['i.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com']);
        if (imageURL) {
            const image = document.createElement('img');
            image.src = imageURL;
            image.alt = '';
            image.width = 64;
            image.height = 64;
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('error', () => art.replaceChildren(document.createTextNode('♪')), { once: true });
            art.replaceChildren(image);
        }
        const info = document.createElement('span');
        info.className = 'track-info';
        info.append(textElement('span', 'track-name', track.name), textElement('span', 'track-artist', track.artists.join(', ')));
        const date = textElement('time', 'track-date', new Date(track.playedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
        date.dateTime = track.playedAt;
        link.append(textElement('span', 'track-number', String(index + 1).padStart(2, '0')), art, info, date);
        item.append(link);
        return item;
    });
    document.querySelector('#recently-played-tracks').replaceChildren(...rows);
    widget.hidden = rows.length === 0;
    widget.scrollTop = resetScroll ? 0 : previousScroll;
    updateHistoryStatus();
}
document.querySelector('#history-limit').addEventListener('change', () => renderHistory(true));

function unavailableSpotify(message) {
    document.querySelector('#currently-playing-status').hidden = false;
    document.querySelector('#currently-playing-status').textContent = message;
    document.querySelector('#recently-played-status').textContent = message;
    document.querySelector('#current-track').hidden = true;
    document.querySelector('#playback-state').hidden = true;
    recentTracks = [];
    recentStatus = null;
    renderHistory();
}

let spotifyTimer;
let spotifyLoading = false;
async function loadSpotify() {
    clearTimeout(spotifyTimer);
    if (document.hidden || spotifyLoading) return;
    spotifyLoading = true;
    let refresh = true;
    try {
        const response = await fetch('/api/spotify?v=2', { cache: 'no-store', signal: AbortSignal.timeout(35_000) });
        if (!response.ok) throw new Error('Activity unavailable');
        const data = await response.json();
        if (data.status === 'not-configured') {
            unavailableSpotify('Spotify listening activity is not connected yet.');
            refresh = false;
            return;
        }
        if (data.status !== 'connected') throw new Error('Activity unavailable');
        const current = data.current;
        const link = safeURL(current?.url, ['open.spotify.com']);
        const hasCurrent = Boolean(current && link);
        const status = document.querySelector('#currently-playing-status');
        status.hidden = hasCurrent;
        status.textContent = data.currentStatus === 'unavailable' ? 'Current playback is temporarily unavailable.' : 'Nothing playing right now.';
        document.querySelector('#current-track').hidden = !hasCurrent;
        const state = document.querySelector('#playback-state');
        state.hidden = !hasCurrent;
        if (hasCurrent) {
            document.querySelector('#current-track').href = link;
            document.querySelector('#current-name').textContent = current.name;
            document.querySelector('#current-artist').textContent = current.artists.join(', ');
            const image = safeURL(current.image, ['i.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com']);
            const art = document.querySelector('#current-art');
            art.hidden = !image;
            if (image) art.src = image;
            state.textContent = current.isPlaying ? 'Playing' : 'Paused';
            state.classList.toggle('is-playing', current.isPlaying);
        }
        const tracks = (data.recent ?? []).filter((track) => safeURL(track.url, ['open.spotify.com']) && Array.isArray(track.artists) && Number.isFinite(Date.parse(track.playedAt)))
            .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt)).slice(0, 100);
        recentStatus = data.recentStatus;
        if (JSON.stringify(tracks) !== JSON.stringify(recentTracks)) {
            recentTracks = tracks;
            renderHistory();
        }
        updateHistoryStatus();
    } catch {
        unavailableSpotify('Spotify listening activity is temporarily unavailable.');
    } finally {
        spotifyLoading = false;
        if (refresh && !document.hidden) spotifyTimer = setTimeout(loadSpotify, 30_000);
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(spotifyTimer);
    else loadSpotify();
});
loadSpotify();

let filmsTimer;
let filmsLoading = false;
let filmsSnapshot = '';
async function loadFilms() {
    clearTimeout(filmsTimer);
    if (document.hidden || filmsLoading) return;
    filmsLoading = true;
    const status = document.querySelector('#films-status');
    try {
        const response = await fetch('/api/letterboxd?v=2', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Feed unavailable');
        const documentXML = new DOMParser().parseFromString(await response.text(), 'application/xml');
        if (documentXML.querySelector('parsererror') || !documentXML.querySelector('rss')) throw new Error('Invalid feed');
        const films = [...documentXML.querySelectorAll('item')].map((item) => {
            const field = (name) => item.getElementsByTagNameNS('https://letterboxd.com', name)[0]?.textContent ?? '';
            const description = item.querySelector('description')?.textContent ?? '';
            const image = description.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;', '&');
            return {
                name: field('filmTitle'), year: field('filmYear'), watched: field('watchedDate'), rating: field('memberRating'),
                published: item.querySelector('pubDate')?.textContent,
                url: safeURL(item.querySelector('link')?.textContent, ['letterboxd.com']),
                image: safeURL(image, ['a.ltrbxd.com']),
            };
        }).filter((film) => film.name && film.url && Number.isFinite(Date.parse(film.watched)))
            .sort((a, b) => Date.parse(b.watched) - Date.parse(a.watched) || Date.parse(b.published) - Date.parse(a.published)).slice(0, 4);
        status.hidden = films.length > 0;
        if (!films.length) status.textContent = 'No recent films to show.';
        const snapshot = JSON.stringify(films);
        if (snapshot === filmsSnapshot) return;
        const cards = films.map((film) => {
            const card = externalLink(film.url);
            card.className = 'film-card';
            const poster = textElement('span', 'film-poster', 'No poster');
            if (film.image) {
                const image = document.createElement('img');
                image.src = film.image;
                image.alt = `${film.name} poster`;
                image.width = 300;
                image.height = 450;
                image.loading = 'lazy';
                image.addEventListener('error', () => poster.replaceChildren(document.createTextNode('No poster')), { once: true });
                poster.replaceChildren(image);
            }
            const meta = textElement('span', 'film-meta', `${film.year} · Watched ${new Date(film.watched).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`);
            const rating = Number(film.rating);
            if (rating > 0 && rating <= 5) {
                const stars = textElement('span', 'film-rating', '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : ''));
                stars.setAttribute('aria-label', `${rating} out of 5 stars`);
                meta.append(stars);
            }
            card.append(poster, textElement('h4', '', film.name), meta);
            return card;
        });
        document.querySelector('#recent-films').replaceChildren(...cards);
        filmsSnapshot = snapshot;
    } catch {
        status.hidden = false;
        status.textContent = document.querySelector('.film-card')
            ? 'Could not refresh recent films. Showing the last loaded entries.'
            : 'Recent films are temporarily unavailable. View my profile below.';
    } finally {
        filmsLoading = false;
        if (!document.hidden) filmsTimer = setTimeout(loadFilms, 5 * 60_000);
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(filmsTimer);
    else loadFilms();
});
loadFilms();
