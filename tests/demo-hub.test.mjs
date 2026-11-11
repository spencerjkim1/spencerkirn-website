import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../demo.html', import.meta.url), 'utf8');

test('demo hub features only the existing WAF demo without placeholders', () => {
    assert.equal((html.match(/class="demo-feature"/g) || []).length, 1);
    assert.match(html, /href="\/demo\/appsec"/);
    assert.match(html, /id="waf-title">WAF</);
    assert.doesNotMatch(html, /Coming Soon|href="#"|runs on Pages|Core Platform|Storage &amp; Data|Workers AI|Browser Rendering/);
});

test('demo hub provides navigation and clearly labels the diagram as an illustration', () => {
    assert.match(html, /class="skip-link" href="#demos"/);
    assert.match(html, /href="\/"/);
    assert.match(html, /id="page-title"/);
    assert.match(html, /Request flow <span>Illustration</);
    assert.match(html, /not live traffic/);
    assert.match(html, /aria-label="Back to top"/);
    assert.doesNotMatch(html, /<script\b/);
});

test('demo hub stylesheet is independently scoped and supports reduced motion', async () => {
    const css = await readFile(new URL('../assets/demo-hub.css', import.meta.url), 'utf8');
    assert.match(html, /href="\/assets\/demo-hub\.css\?v=1"/);
    assert.doesNotMatch(html, /href="\/assets\/site\.css/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /focus-visible/);
    assert.match(css, /max-width: 700px/);
});
