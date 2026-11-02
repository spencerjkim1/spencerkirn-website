import test from 'node:test';
import assert from 'node:assert/strict';
import { validState, mergeDevVars, exchangeCode } from '../scripts/connect-spotify.mjs';

test('callback state must exactly match the random nonce', () => {
    assert.equal(validState('abc123', 'abc123'), true);
    for (const invalid of [null, undefined, '', 'abc12', 'abc124', 'ABC123']) assert.equal(validState(invalid, 'abc123'), false);
});

test('saving credentials preserves unrelated config and removes duplicate old assignments', () => {
    const existing = '# Keep this comment\nOTHER_KEY="value"\nSPOTIFY_CLIENT_ID="old"\nSPOTIFY_CLIENT_ID="duplicate"\nexport SPOTIFY_REFRESH_TOKEN="old"\n';
    const merged = mergeDevVars(existing, { SPOTIFY_CLIENT_ID: 'new-id', SPOTIFY_CLIENT_SECRET: 'new-secret', SPOTIFY_REFRESH_TOKEN: 'new-token' });
    assert.match(merged, /# Keep this comment\nOTHER_KEY="value"/);
    assert.doesNotMatch(merged, /old|duplicate|export/);
    assert.equal(merged.match(/SPOTIFY_CLIENT_ID=/g).length, 1);
    assert.match(merged, /SPOTIFY_REFRESH_TOKEN="new-token"/);
});

test('saved values are quoted safely', () => {
    assert.equal(mergeDevVars('', { SPOTIFY_REFRESH_TOKEN: 'a"b\\c' }), 'SPOTIFY_REFRESH_TOKEN="a\\"b\\\\c"\n');
});

test('authorization exchange sends the exact redirect and returns the refresh token privately', async () => {
    const token = await exchangeCode('client', 'secret', 'authorization-code', async (url, options) => {
        assert.equal(url, 'https://accounts.spotify.com/api/token');
        assert.equal(options.headers.Authorization, `Basic ${Buffer.from('client:secret').toString('base64')}`);
        assert.equal(options.body.get('redirect_uri'), 'http://127.0.0.1:8888/callback');
        assert.equal(options.body.get('grant_type'), 'authorization_code');
        assert.equal(options.body.get('code'), 'authorization-code');
        return Response.json({ refresh_token: 'private-refresh-token', scope: 'user-read-currently-playing user-read-recently-played' });
    });
    assert.equal(token, 'private-refresh-token');
});

test('upstream failures never include provider response bodies in errors', async () => {
    await assert.rejects(exchangeCode('client', 'secret', 'code', async () => new Response('secret-provider-error', { status: 400 })), (error) => {
        assert.match(error.message, /Spotify rejected the authorization \(400\)/);
        assert.doesNotMatch(error.message, /secret-provider-error/);
        return true;
    });
});

test('authorization requires both listening permissions and a refresh token', async () => {
    await assert.rejects(exchangeCode('client', 'secret', 'code', async () => Response.json({ refresh_token: 'token', scope: 'user-read-currently-playing' })), /both required permissions/);
    await assert.rejects(exchangeCode('client', 'secret', 'code', async () => Response.json({ scope: 'user-read-currently-playing user-read-recently-played' })), /did not return a refresh token/);
});
