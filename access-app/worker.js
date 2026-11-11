import { createRemoteJWKSet, jwtVerify } from 'jose';

export const APP_HOST = 'access-demo.spencerkirn.com';
const keySets = new Map();
const privateHeaders = {
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
};

export function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export async function verifyAccessToken(token, env, keySet) {
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '') || !env.ACCESS_AUD) throw new Error('Access is not configured');
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    if (!keySet) {
        if (!keySets.has(issuer)) keySets.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 }));
        keySet = keySets.get(issuer);
    }
    const { payload } = await jwtVerify(token, keySet, {
        issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'email', 'sub'], clockTolerance: 5,
    });
    if (typeof payload.email !== 'string' || payload.email.length > 254 || !payload.email.includes('@')) throw new Error('Email identity required');
    return payload;
}

export function renderTeamSpace(identity, nonce) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Team Space — Access Demo</title><style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#f6f4ef;color:#171717;font:700 16px/1.6 'Helvetica Neue',Helvetica,Arial,sans-serif}a{color:inherit;text-underline-offset:4px}a:focus-visible,summary:focus-visible{outline:3px solid #a33e2c;outline-offset:5px}.wrap{width:min(1100px,calc(100% - 48px));margin:auto}header{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;padding:28px 0;border-bottom:2px solid #171717;font-size:12px;text-transform:uppercase}main{padding:64px 0}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#42664c}h1{margin:20px 0;font-size:clamp(3rem,9vw,6rem);line-height:.95;letter-spacing:-.075em}h1 span{color:#a33e2c}.identity{margin:36px 0;padding:24px;background:#fff;border-left:3px solid #42664c;overflow-wrap:anywhere}.identity span{display:block;font-size:11px;color:#68655f}.identity strong{display:block;font-size:clamp(1rem,3vw,1.5rem);margin:8px 0}.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{padding:28px;background:#fff;border:1px solid #d8d4cd}.card h2{margin:0 0 16px;letter-spacing:-.04em;line-height:1.2;font-size:24px}.card p,.card li{font-size:13px;color:#68655f}summary{cursor:pointer;min-height:44px;font-size:13px}.note{margin-top:28px;color:#68655f;font-size:12px;max-width:800px}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#a33e2c}footer{padding:24px 0;border-top:1px solid #d8d4cd;font-size:11px;color:#68655f}@media(max-width:650px){.cards{grid-template-columns:1fr}main{padding-top:44px}.card{padding:22px}}
</style></head><body><div class="wrap"><header><a href="https://spencerkirn.com/demos">← All demos</a><span>Team Space / Cloudflare Access</span><a href="/cdn-cgi/access/logout">Sign out</a></header><main><p class="eyebrow">Authenticated by Cloudflare Access</p><h1>You’re in<span>.</span></h1><p>This application sits behind a real Access login—not a simulated code screen.</p><div class="identity"><span>Your verified email</span><strong>${escapeHTML(identity.email)}</strong><span>The Worker verified the Access token’s signature, issuer, audience and expiry.</span></div><div class="cards"><section class="card"><p class="label">01 / The application</p><h2>Welcome to Team Space.</h2><p>A fictional internal workspace. In your organization, this could be a dashboard, developer tool, or staff application.</p><details><summary>Open the project brief ↓</summary><p><strong>Project Northstar</strong><br>A fictional launch plan: review the release, share a status update, and prepare the team. All content in this demo is synthetic.</p></details></section><section class="card"><p class="label">02 / What just happened</p><h2>Identity before entry.</h2><ol><li>You opened a dedicated protected hostname.</li><li>Cloudflare Access checked your identity using an emailed code (or an existing valid Access session).</li><li>An allow policy granted access to this app only.</li><li>The Worker independently validated the signed token before rendering this page.</li></ol></section></div><p class="note">Public demonstration: anyone who verifies their email may enter. This app contains no private business data. Your demo address is displayed only in this authenticated response; the app does not store it. Cloudflare Access handles email delivery and authentication logs. Access protects this application only—the main demo site remains public. Email OTP is not a device-posture check or a claim of multi-factor authentication.</p><p class="note"><a href="https://spencerkirn.com/demo/zero-trust#gateway">Explore Gateway examples →</a></p></main><footer>Spencer Kim / Access-protected demo application</footer></div></body></html>`;
}

export function createAccessApp(keySet) {
    return {
        async fetch(request, env) {
            const url = new URL(request.url);
            if (url.hostname !== APP_HOST || url.protocol !== 'https:') return new Response('Not found', { status: 404, headers: privateHeaders });
            if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) return new Response('Application is not configured', { status: 503, headers: privateHeaders });
            const token = request.headers.get('Cf-Access-Jwt-Assertion');
            if (!token || token.length > 16384) return new Response('Cloudflare Access authentication required', { status: 401, headers: privateHeaders });
            let identity;
            try { identity = await verifyAccessToken(token, env, keySet); }
            catch { return new Response('Cloudflare Access authentication required', { status: 401, headers: privateHeaders }); }
            if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { ...privateHeaders, Allow: 'GET, HEAD' } });
            if (url.pathname !== '/') return new Response('Not found', { status: 404, headers: privateHeaders });
            const nonce = crypto.randomUUID();
            return new Response(request.method === 'HEAD' ? null : renderTeamSpace(identity, nonce), {
                headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` },
            });
        },
    };
}

export default createAccessApp();
