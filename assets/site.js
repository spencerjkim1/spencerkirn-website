const navLinks = [...document.querySelectorAll('.site-nav a')];
const sectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        navLinks.forEach((link) => {
            if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }
}, { rootMargin: '-10% 0px -65% 0px' });
document.querySelectorAll('main section').forEach((section) => sectionObserver.observe(section));

// Tokens stay in GitHub Actions. The browser only reads public track metadata.
async function loadAllma() {
    const status = document.querySelector('#playlist-status');
    try {
        const response = await fetch('/data/allma.json');
        if (!response.ok) throw new Error('Playlist data unavailable');
        const data = await response.json();
        if (!Array.isArray(data.tracks) || !data.tracks.length) return;
        const tracks = data.tracks.filter((track) => {
            try {
                const url = new URL(track.url);
                return track.name && Array.isArray(track.artists) && url.origin === 'https://open.spotify.com' && url.pathname.startsWith('/track/');
            } catch { return false; }
        }).sort((a, b) => (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || b.position - a.position);
        if (!tracks.length) return;
        const list = document.querySelector('#allma-tracks');
        const more = document.querySelector('#more-tracks');
        let shown = 0;
        function showMore() {
            const fragment = document.createDocumentFragment();
            const end = Math.min(shown + 20, tracks.length);
            for (; shown < end; shown++) {
                const track = tracks[shown];
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.href = track.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                const number = document.createElement('span');
                number.className = 'track-number';
                number.textContent = String(shown + 1).padStart(2, '0');
                const info = document.createElement('span');
                const name = document.createElement('span');
                name.className = 'track-name';
                name.textContent = track.name;
                const artists = document.createElement('span');
                artists.className = 'track-artist';
                artists.textContent = track.artists.join(', ');
                info.append(name, artists);
                const date = document.createElement('span');
                date.className = 'track-date';
                date.textContent = Date.parse(track.addedAt) ? new Date(track.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'From the archives';
                link.append(number, info, date);
                item.append(link);
                fragment.append(item);
            }
            list.append(fragment);
            more.hidden = shown >= tracks.length;
        }
        showMore();
        more.addEventListener('click', showMore);
        document.querySelector('#recent-tracks').hidden = false;
        const updated = Date.parse(data.updatedAt);
        document.querySelector('#playlist-updated').textContent = `${tracks.length.toLocaleString()} songs · via Spotify${updated ? ` · Last updated ${new Date(updated).toLocaleDateString()}` : ''}`;
        status.textContent = 'Track list: newest added first. The embedded player keeps Spotify’s original order.';
    } catch {
        // Keep both Spotify players and the explanatory fallback usable offline or before setup.
        status.textContent = 'The player follows Spotify’s original playlist order. Open allma on Spotify to explore the full collection.';
    }
}
loadAllma();
