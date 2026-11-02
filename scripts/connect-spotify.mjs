import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { readFile, lstat, open, rename, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = ['user-read-currently-playing', 'user-read-recently-played'];
const secretFile = new URL('../.dev.vars', import.meta.url);

export function validState(actual, expected) {
    if (typeof actual !== 'string' || !actual || typeof expected !== 'string') return false;
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

export function mergeDevVars(existing, credentials) {
    const keys = Object.keys(credentials);
    const oldAssignments = new RegExp(`^\\s*(?:export\\s+)?(?:${keys.join('|')})\\s*=`);
    const kept = existing.split(/\r?\n/).filter((line) => !oldAssignments.test(line)).join('\n').trimEnd();
    return `${kept ? `${kept}\n` : ''}${keys.map((key) => `${key}=${JSON.stringify(credentials[key])}`).join('\n')}\n`;
}

export async function exchangeCode(clientId, clientSecret, code, fetcher = fetch, signal) {
    const response = await fetcher('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Spotify rejected the authorization (${response.status}). Check the app credentials and redirect URI, then retry.`);
    const token = await response.json();
    const granted = new Set((token.scope ?? '').split(' '));
    if (!SCOPES.every((scope) => granted.has(scope))) throw new Error('Spotify did not grant both required permissions. Please reconnect and approve them.');
    if (!token.refresh_token) throw new Error('Spotify did not return a refresh token. Please reconnect.');
    return token.refresh_token;
}

async function saveCredentials(credentials) {
    let existing = '';
    try {
        const info = await lstat(secretFile);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('.dev.vars must be a regular file, not a symbolic link.');
        existing = await readFile(secretFile, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = new URL(`../.dev.vars.spotify-${randomBytes(8).toString('hex')}`, import.meta.url);
    try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(mergeDevVars(existing, credentials)); } finally { await file.close(); }
        await rename(temporary, secretFile);
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

function ask(question, hidden = false) {
    if (!process.stdin.isTTY) throw new Error('Run this command in your own interactive Terminal so credentials can be entered privately.');
    return new Promise((resolveAnswer, reject) => {
        let muted = false;
        let answered = false;
        const output = new Writable({ write(chunk, encoding, done) {
            if (!muted) process.stdout.write(chunk, encoding);
            done();
        } });
        const readline = createInterface({ input: process.stdin, output, terminal: true });
        readline.once('close', () => { if (!answered) reject(new Error('Connection canceled.')); });
        readline.once('SIGINT', () => readline.close());
        readline.question(question, (answer) => {
            answered = true;
            readline.close();
            if (hidden) process.stdout.write('\n');
            resolveAnswer(answer.trim());
        });
        muted = hidden;
    });
}

export async function connectSpotify() {
    console.log('Connect the Spotify account you want to display on your public website.');
    console.log('Client secrets and refresh tokens stay in the gitignored .dev.vars file and are never printed.');
    console.log(`Your app must have this exact redirect URI: ${REDIRECT_URI}\n`);
    const clientId = await ask('Paste Client ID: ');
    const clientSecret = await ask('Paste Client Secret (input is hidden): ', true);
    if (!/^[a-zA-Z0-9]+$/.test(clientId) || !/^[a-zA-Z0-9]+$/.test(clientSecret)) throw new Error('Enter the app Client ID and Client Secret, not an app name or URL.');
    const state = randomBytes(32).toString('hex');
    const authorize = new URL('https://accounts.spotify.com/authorize');
    authorize.search = new URLSearchParams({
        client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI,
        scope: SCOPES.join(' '), state, show_dialog: 'true',
    });
    let complete;
    let fail;
    const result = new Promise((resolveResult, reject) => { complete = resolveResult; fail = reject; });
    // Attach a handler immediately so startup/timeout failures never become unhandled rejections.
    result.catch(() => {});
    const controller = new AbortController();
    let processing = false;
    const server = createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        let url;
        try { url = new URL(request.url, REDIRECT_URI); } catch { response.writeHead(400).end('Invalid request.'); return; }
        if (request.method !== 'GET' || url.pathname !== '/callback') { response.writeHead(404).end('Not found.'); return; }
        if (!validState(url.searchParams.get('state'), state)) { response.writeHead(400).end('Invalid authorization state. Return to the authorization link in Terminal.'); return; }
        if (processing) { response.writeHead(409).end('Authorization is already being processed.'); return; }
        processing = true;
        try {
            if (url.searchParams.has('error')) throw new Error('Spotify authorization was declined. Run the command again when ready.');
            const code = url.searchParams.get('code');
            if (!code) throw new Error('Spotify did not return an authorization code. Please retry.');
            const refreshToken = await exchangeCode(clientId, clientSecret, code, fetch, controller.signal);
            controller.signal.throwIfAborted();
            await saveCredentials({ SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret, SPOTIFY_REFRESH_TOKEN: refreshToken });
            response.end('Spotify connected locally. You can close this tab and return to Terminal.');
            complete();
        } catch (error) {
            response.writeHead(400).end('Could not finish connecting. Return to Terminal for instructions.');
            fail(error);
        }
    });
    const canceled = () => fail(new Error('Connection canceled.'));
    process.once('SIGINT', canceled);
    let timeout;
    let succeeded = false;
    try {
        await new Promise((ready, reject) => {
            server.once('error', () => reject(new Error('Could not start the callback listener. Free port 8888 and retry.')));
            server.listen(8888, '127.0.0.1', ready);
        });
        timeout = setTimeout(() => fail(new Error('Authorization timed out after five minutes. Run the command again.')), 5 * 60_000);
        console.log('\nApprove access in the browser. If it does not open, open this URL yourself:');
        console.log(authorize.href);
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
        spawn(command, [authorize.href], { stdio: 'ignore' }).on('error', () => {});
        await result;
        succeeded = true;
        console.log('\nConnected! Saved credentials privately to .dev.vars. No tokens were printed.');
        console.log('Restart npm run dev, then open http://localhost:8081/ to check your listening activity.');
        console.log('Production still needs these three secrets in the Cloudflare Worker and a deployment.');
    } finally {
        clearTimeout(timeout);
        process.removeListener('SIGINT', canceled);
        controller.abort();
        server.close();
        if (!succeeded) server.closeAllConnections();
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    connectSpotify().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
