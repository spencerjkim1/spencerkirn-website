// Browser/CDN caching is separate from the short-lived, explicit Worker cache.
export function browserResponse(response) {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('CDN-Cache-Control', 'no-store');
    headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
}
