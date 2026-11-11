const process = document.querySelector('#process');
const processLabel = document.querySelector('#process-label');
const status = document.querySelector('#lab-status');
const code = document.querySelector('#source-code');
const copyCode = document.querySelector('#copy-code');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

document.querySelector('#runtime-label').textContent = local ? 'Local preview / Not deployed' : 'Runs on this site’s Cloudflare Worker';

async function copy(text, message) {
    try {
        await navigator.clipboard.writeText(text);
        status.textContent = message;
    } catch {
        status.textContent = 'Clipboard unavailable. Select and copy the text directly.';
    }
}

copyCode.addEventListener('click', () => copy(code.textContent, 'Processing code copied. This module needs a Worker entry point.'));
document.querySelector('#copy-command').addEventListener('click', () => copy('npx wrangler deploy', 'Deployment command copied. Run it in your configured project—not on this page.'));
document.querySelector('#copy-command').disabled = false;

async function loadSource() {
    try {
        const response = await fetch('/assets/clean-orders.js?v=1', { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Source unavailable');
        const source = await response.text();
        code.textContent = source;
        document.querySelector('#code-lines').textContent = `${source.trimEnd().split('\n').length} lines / Actual source`;
        copyCode.disabled = false;
    } catch {
        code.textContent = 'Could not load the source. Use the View source link below.';
    }
}

process.addEventListener('click', async () => {
    process.disabled = true;
    processLabel.textContent = 'Running…';
    document.body.dataset.state = 'processing';
    document.querySelector('.lab-run').setAttribute('aria-busy', 'true');
    document.querySelector('#result').hidden = true;
    status.textContent = 'Sending a real request. Waiting for the Worker’s response…';
    try {
        const start = performance.now();
        const response = await fetch('/api/demo/process', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset: 'large' }), cache: 'no-store', signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'The request failed. Please try again.');
        const roundTripMs = Math.round(performance.now() - start);
        const { summary, execution } = data;
        document.querySelector('#accepted').textContent = summary.accepted.toLocaleString();
        document.querySelector('#result-summary').textContent = `${summary.input} input rows · ${summary.duplicates} duplicates removed · ${summary.rejected} invalid rows rejected · ${summary.redacted} emails redacted`;
        document.querySelector('#execution').textContent = `${execution.runtime}${execution.colo ? ` / ${execution.colo}` : ''} · ${roundTripMs} ms round trip · Nothing stored`;
        document.querySelector('#response-code').textContent = JSON.stringify({ summary, firstCleanOrder: data.rows[0], execution }, null, 2);
        document.querySelector('#result').hidden = false;
        document.body.dataset.state = 'complete';
        status.textContent = 'Complete. Real processing, real response.';
    } catch (error) {
        document.body.dataset.state = 'error';
        status.textContent = error.name === 'TimeoutError' ? 'The request timed out. Please try again.' : error.message;
    } finally {
        process.disabled = false;
        processLabel.textContent = 'Run Worker';
        document.querySelector('.lab-run').removeAttribute('aria-busy');
    }
});

loadSource();
process.disabled = false;
