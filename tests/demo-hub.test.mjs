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

test('demo hub provides navigation and clearly labels the traffic sequence as a simulation', () => {
    assert.match(html, /class="skip-link" href="#demos"/);
    assert.match(html, /href="\/"/);
    assert.match(html, /id="page-title"/);
    assert.match(html, /Traffic sequence <span>Simulated examples</);
    assert.match(html, /not live traffic/);
    assert.match(html, /aria-label="Back to top"/);
    assert.match(html, /type="module" src="\/assets\/request-flow\.js\?v=4"/);
});

test('demo hub stylesheet is independently scoped and supports reduced motion', async () => {
    const css = await readFile(new URL('../assets/demo-hub.css', import.meta.url), 'utf8');
    assert.match(html, /href="\/assets\/demo-hub\.css\?v=3"/);
    assert.doesNotMatch(html, /href="\/assets\/site\.css/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /focus-visible/);
    assert.match(css, /max-width: 700px/);
});

test('traffic sequence includes the requested product overview without claiming live counts', () => {
    for (const name of ['HTTP Request', 'General Rules', 'DDoS protection', 'WAF', 'Bots', 'Rate Limiting', 'Application']) {
        assert.ok(html.includes(name), `Missing ${name}`);
    }
    assert.equal((html.match(/<li data-stage=/g) || []).length, 5);
    assert.doesNotMatch(html, /<h4>(Redirect Rules|URL Normalization|URL Rewrites|Page Rules|Origin Rules|Access)<\/h4>/);
    assert.match(html, /actual execution depends on configuration/);
    assert.match(html, /Score and country blocks require configured rules/);
    assert.doesNotMatch(html, /\d+ rules? active/);
    assert.match(html, /aria-label="Pause request animation"/);
});
