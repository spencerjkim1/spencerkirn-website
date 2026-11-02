# Spencer Kim’s website

Static HTML/CSS/JavaScript served by the existing Cloudflare **Worker** named
`spencerkirn-website` (not a Pages project), with two server-side API handlers. The build
copies only approved public files to `.site`; credentials and server code are
never served as static assets. Navigation: Spotify 01, Letterboxd 02, Demos 03. Gallery is removed;
its starter SVGs remain in `assets/gallery/` for possible future use.

## Preview and test

```sh
npm install
npm run dev
npm test
```

Open http://localhost:8081. Wrangler runs both the static site and `/api/*`.
`npm run dev` prepares `.site` first and watches the static source files.
**Never serve the repository root with a static server**, because local `.dev.vars`
contains credentials. A plain static server pointed at `.site` still shows On Repeat and the profile links, but cannot
serve live listening activity or the Letterboxd feed. Existing `/demo` routing
is unchanged. Only `/api/*` runs the Worker before assets. `wrangler.jsonc`
binds the prepared public directory as `ASSETS`; server code remains outside it.

## Interactive tree header

The homepage uses a transparent cutout of the original favicon artwork over a
subtle cream background. `assets/tree.js` bends the canopy toward the mouse with
a springy sway and a short, fading ripple through the branches, while keeping
the trunk anchored. It renders only while movement is settling, stops
when hidden or offscreen, and uses no animation library. Touchscreens, reduced-
motion preferences, and browsers without JavaScript/canvas get a still tree.
The artwork is decorative and does not block text selection or navigation.

## Visual design

The header has a low-opacity, static paper-grain SVG behind its artwork and text.
Typography uses two local font stacks: Helvetica Neue for the name, navigation,
and metadata; Georgia for film titles. No web-font downloads or third-party
texture requests are needed. Rust (`#a33e2c`) is the sole interface accent for
links, active navigation, playback indicator, focus rings, and the history control.

On mouse hover, album covers zoom 4.5% inside clipped frames and film posters
lift 4px without shifting surrounding text. Links reveal thin underlines. Keyboard
focus gets equivalent feedback; reduced-motion settings disable artwork movement
and transitions. Touchscreens do not depend on hover. Letterboxd stars stay 18px.

## Spotify

Spotify responses are never stored in the browser or automatic CDN cache. Only
the Worker's explicit Cache API keeps a normalized public snapshot for 30 seconds.
The frontend uses `cache: 'no-store'` so a previously cached response cannot freeze
the widget on old songs. Its script URL is versioned when this request policy changes.

Order: **Currently playing**, **Recently played**, the On Repeat player without
an extra heading, then the profile link labeled **Spotify**. The allma embed,
playlist-data file, and scheduled sync are removed.

Currently playing shows album art, song, artist, Spotify link, and Playing/Paused
state. Recently played has a 20/50/100-song selector inside a bounded, keyboard-
scrollable widget. Each row includes square album art, song title, artist, and
timestamp (including on mobile). Missing covers have a neutral fallback. Changing
the selector resets the widget to the newest play; refreshes preserve its scroll
position. The page stays compact regardless of the selected count.
History is sorted by `played_at`, newest first, and repeated plays are retained.
These are listening events Spotify reports, not a complete real-time audit;
Spotify’s recently-played endpoint can lag playback and excludes podcasts.
Spotify allows 50 events per API request; the function requests a second, older
page to show up to 100 plays when available. Spotify may return fewer than the
selected number. The UI displays the actual count rather than inventing entries.
This is not a persistent 100-song archive. Identical duplicate events are removed,
but repeat listens at different timestamps are retained. If the older-page
request fails, the latest available plays remain visible.
An idle account shows “Nothing playing right now,” not a fake live song.

### One-time connection

1. Create an app at the [Spotify developer dashboard](https://developer.spotify.com/dashboard).
   Spotify development-mode access may require Premium and account allowlisting.
2. In the app settings, save redirect URI **`http://127.0.0.1:8888/callback`**.
   In your own interactive Terminal, run `npm run spotify:connect`. Paste the
   Client ID and Client Secret when prompted (secret input is hidden). The helper
   opens Spotify to authorize **your own listening account** with scopes
   **`user-read-currently-playing user-read-recently-played`**. It validates a
   random callback state, exchanges the code locally, and saves all three
   credentials to `.dev.vars` with owner-only permissions. Tokens are never
   printed. Unrelated `.dev.vars` settings are preserved. Approval times out
   after five minutes; rerun the command if needed. Restart `npm run dev` to
   test locally. An old playlist-only token will not grant these scopes.
3. Add these **secrets to the existing Cloudflare Worker**, under Settings →
   Variables and Secrets:
    - `SPOTIFY_CLIENT_ID`
    - `SPOTIFY_CLIENT_SECRET`
    - `SPOTIFY_REFRESH_TOKEN`
   If `.dev.vars` contains only these three settings, you can upload them without
   copying tokens through the clipboard: run `npx wrangler login`, then
   `npx wrangler secret bulk .dev.vars --name spencerkirn-website`.
   Choose the Cloudflare account that owns this Worker (Spencer-Sandbox).
   Do not bulk-upload a file containing unrelated secrets. `wrangler pages`
   commands do not apply to this site.
4. Deploy the new Worker code after setting the secrets. For Workers Builds/Git
   integration, use build command **`npm run build`** and deploy command
   **`npx wrangler deploy`**. Wrangler also runs the configured build automatically
   before direct CLI deployment. No Pages build-output setting is needed.
   No GitHub Actions secrets or scheduled jobs are needed.

For local testing, put the same values in a `.dev.vars` file (gitignored), then
restart `npm run dev`. Never commit credentials or paste them into chat.
Reauthorize if Spotify revokes/rotates the refresh token or scopes change.

**Privacy:** Connecting this feature deliberately publishes your current song
and up to 100 recent listening events, including timestamps, to anyone visiting
the site or `/api/spotify`. It is a display of the owner's account, not a
visitor login. Remove the secrets to disable it, then allow the 30-second edge
cache to expire. No history is committed to Git or retained in a database.

Tokens are exchanged only in the server-side function and never sent to the
browser. Only normalized song metadata is returned. The public response is
edge-cached for up to 30 seconds, and the visible page polls every 30 seconds;
it pauses polling in background tabs. Offline, unconfigured, paused, idle,
partial failure, and API error states are handled separately.

## Letterboxd

The last four diary entries appear as posters with film titles, years, watched
dates, ratings, and links to Spencer’s reviews. Data comes from the public
https://letterboxd.com/spencerjkim/rss/ feed via `/api/letterboxd`.
No API key or Letterboxd login is needed. Only the explicit Worker cache keeps
the feed for five minutes; browser and automatic CDN caching are disabled, and
the frontend fetches with `cache: 'no-store'`. List/non-film items are excluded and diary entries are sorted by
watched date, then publication date. The profile link remains available if the
feed or a poster fails. Raw review HTML is never inserted into the page.

The visible page refreshes films every five minutes and checks again when you
return to the tab. Once you **log a film in your Letterboxd diary**, it can
automatically enter the newest four cards, usually within 5–10 minutes plus any
delay in Letterboxd’s RSS feed. Merely watching a film without logging it cannot
be detected. Refresh failures retain the last loaded posters with a notice.
Unchanged cards are not replaced, preserving keyboard focus. Both live features
require deployment of the Worker API handlers; Spotify also requires authorization.
