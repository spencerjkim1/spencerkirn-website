# Spencer Kim’s website

Static HTML, CSS, and JavaScript. No build step or browser-side credentials.

## Preview and test

```sh
python3 -m http.server 8080
node --test scripts/sync-spotify.test.mjs
```

Open http://localhost:8080. Existing `/demo` routing is unchanged.

## Navigation

The page starts with Spotify 01, followed by Letterboxd 02 and Demos 03.
The Gallery is removed for now; its starter SVGs remain in `assets/gallery/`
for possible future use. Room subtitles and playlist descriptions are omitted.

## allma: newest additions first

On Repeat stays first; allma is underneath. Both official Spotify players work
immediately. **Spotify embeds do not expose a playlist-sort setting.** A separate
text track list above the allma player displays songs by `added_at` descending
(not album release date).
It links songs to Spotify and loads 20 rows at a time. The player itself retains
Spotify’s order; this does not reorder or otherwise modify your real playlist.

The list is initially hidden until the first sync; both players remain available.
To connect it:

1. Create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard).
   Spotify may require Premium and developer-mode account allowlisting. Authorize
   as the owner/collaborator of allma; current development-mode playlist access is
   restricted. See [Spotify’s February 2026 migration guide](https://developer.spotify.com/documentation/web-api/references/changes/february-2026).
2. Use Spotify’s [Authorization Code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow)
   to obtain a refresh token for that account with `playlist-read-private` scope
   (also `playlist-read-collaborative` if applicable). Use your own app; do not
   give credentials to third-party token generators or paste them into this repo.
3. In GitHub → repository **Settings → Secrets and variables → Actions**, add
   repository **secrets** `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and
   `SPOTIFY_REFRESH_TOKEN`. Add a repository **variable** `SPOTIFY_SYNC_ENABLED`
   set to `true`.
4. Once these changes are on the default branch, run **Actions → Sync allma
   playlist → Run workflow**. It then refreshes roughly every six hours.
   Branch rules must permit the workflow bot to commit `data/allma.json`.
   Cloudflare Pages should deploy these commits through the existing Git integration.

Only public song names, artist names, Spotify links, added dates, and playlist
positions are committed to `data/allma.json`. All pages are fetched before sorting;
removed/local/non-song entries are skipped, duplicates are preserved, and unknown
added dates appear last. Failed syncs preserve the previous file. Unchanged tracks
do not create a commit; the displayed update date is the last changed snapshot.

The workflow is opt-in and makes read-only Spotify requests. It requires Node 22
and no npm dependencies. To sync locally, set the same three environment variables
and run `node scripts/sync-spotify.mjs`. Never commit tokens. If Spotify rotates or
revokes your refresh token, re-authorize and update the GitHub secret.
