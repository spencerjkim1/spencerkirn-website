const canvas = document.querySelector('#draw-canvas');
const context = canvas.getContext('2d');
const status = document.querySelector('#draw-status');
const send = document.querySelector('#draw-send');
const undo = document.querySelector('#draw-undo');
const clear = document.querySelector('#draw-clear');
const eraser = document.querySelector('#draw-eraser');
const desk = document.querySelector('.drawing-desk');
const strokes = [];
let active = null;
let erasing = false;
let pointer = null;
let pointCount = 0;
let busy = false;
let sent = false;
let token = '';
let widget;
let available = false;
let feedback = '';
let maxBytes = 1024 * 1024;

function controls() {
    undo.disabled = clear.disabled = busy || pointer !== null || !strokes.length;
    eraser.disabled = busy || pointer !== null;
    send.disabled = busy || !available || !token || !strokes.length || sent || pointer !== null;
    desk.querySelectorAll('input, select').forEach((control) => { control.disabled = busy; });
}

function paint(stroke) {
    context.strokeStyle = context.fillStyle = stroke.color;
    context.lineWidth = stroke.size;
    context.lineCap = context.lineJoin = 'round';
    context.beginPath();
    if (stroke.points.length === 1) {
        context.arc(...stroke.points[0], stroke.size / 2, 0, Math.PI * 2);
        context.fill();
    } else {
        context.moveTo(...stroke.points[0]);
        for (const point of stroke.points.slice(1)) context.lineTo(...point);
        context.stroke();
    }
}

function redraw() {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(paint);
}

function position(event) {
    const rect = canvas.getBoundingClientRect();
    return [
        Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
        Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    ];
}

canvas.addEventListener('pointerdown', (event) => {
    if (busy || pointer !== null || event.button !== 0) return;
    if (pointCount >= 20000 || strokes.length >= 1000) {
        status.textContent = 'This drawing is full. Undo a stroke or clear the canvas to keep drawing.';
        return;
    }
    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    active = { color: erasing ? '#fff' : document.querySelector('input[name="ink"]:checked').value, size: Number(document.querySelector('#draw-size').value), points: [position(event)] };
    strokes.push(active);
    pointCount++;
    sent = false;
    feedback = '';
    paint(active);
    if (available) status.textContent = token ? '' : 'Finish the verification below to send your drawing.';
    controls();
});

canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer || !active || pointCount >= 20000) return;
    const point = position(event);
    const previous = active.points.at(-1);
    if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 1) return;
    active.points.push(point);
    pointCount++;
    paint({ ...active, points: [previous, point] });
});

function finish(event) {
    if (event.pointerId !== pointer) return;
    active = null;
    pointer = null;
    controls();
}
canvas.addEventListener('pointerup', finish);
canvas.addEventListener('pointercancel', finish);
canvas.addEventListener('lostpointercapture', finish);

eraser.addEventListener('click', () => {
    if (busy || pointer !== null) return;
    erasing = !erasing;
    eraser.setAttribute('aria-pressed', String(erasing));
});
document.querySelectorAll('input[name="ink"]').forEach((input) => {
    input.addEventListener('change', () => {
        erasing = false;
        eraser.setAttribute('aria-pressed', 'false');
    });
});

undo.addEventListener('click', () => {
    if (busy) return;
    pointCount -= strokes.pop()?.points.length ?? 0;
    sent = false;
    feedback = '';
    if (available) status.textContent = token ? '' : 'Please complete verification to send.';
    redraw();
    controls();
});
clear.addEventListener('click', () => {
    if (busy || !window.confirm('Clear your drawing?')) return;
    strokes.length = pointCount = 0;
    sent = false;
    feedback = '';
    if (available) status.textContent = '';
    redraw();
    controls();
});

async function loadChallenge(sitekey) {
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
    });
    widget = window.turnstile.render('#draw-challenge', {
        sitekey,
        action: 'draw-sumn',
        size: window.matchMedia('(max-width: 480px)').matches ? 'compact' : 'normal',
        callback: (value) => {
            token = value;
            status.textContent = feedback || (sent ? 'Sent. Thank you for the drawing!' : '');
            controls();
        },
        'expired-callback': () => { token = ''; controls(); status.textContent = 'Verification expired. Please verify again; your drawing is still here.'; },
        'error-callback': () => { token = ''; controls(); status.textContent = 'Verification failed. Please retry the verification; your drawing is still here.'; },
    });
}

send.addEventListener('click', async () => {
    if (send.disabled) return;
    busy = true;
    feedback = '';
    desk.setAttribute('aria-busy', 'true');
    controls();
    status.textContent = 'Sending your drawing…';
    try {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob || blob.size > maxBytes) throw new Error('This drawing is too large to send. Try a simpler drawing.');
        const response = await fetch('/api/drawings', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'image/png', 'X-Turnstile-Token': token },
            body: blob,
            signal: AbortSignal.timeout(25000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not send your drawing. Please try again.');
        sent = true;
        status.textContent = 'Sent. Thank you for the drawing!';
    } catch (error) {
        feedback = error.name === 'TimeoutError' || error.name === 'TypeError'
            ? 'Could not confirm delivery. Your drawing is still here; retrying may send a duplicate.'
            : error.message;
        status.textContent = feedback;
    } finally {
        busy = false;
        desk.removeAttribute('aria-busy');
        token = '';
        controls();
        if (widget !== undefined) window.turnstile.reset(widget);
    }
});

async function setup() {
    redraw();
    try {
        const response = await fetch('/api/drawings', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Unavailable');
        const config = await response.json();
        if (!config.enabled) {
            status.textContent = 'Try the canvas. Sending will be available once the private inbox is connected.';
            return;
        }
        available = true;
        maxBytes = config.maxBytes;
        status.textContent = 'Draw something while verification loads.';
        // Load third-party verification only when the drawing section is nearby.
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            loadChallenge(config.sitekey).catch(() => {
                available = false;
                controls();
                status.textContent = 'Verification could not load. Your drawing is still here; check your connection or content blocker.';
            });
        }, { rootMargin: '300px' });
        observer.observe(canvas);
    } catch {
        status.textContent = 'Sending is temporarily unavailable. You can still try the canvas.';
    }
}
setup();
