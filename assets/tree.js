// The original tree print stays visible if scripts, canvas, or motion are unavailable.
// Movement is input-driven, not a permanent animation loop.
export function branchOffset(y, height, lean) {
    if (height <= 0) return 0;
    const canopy = Math.max(0, Math.min(1, (0.88 - y / height) / 0.88));
    return lean * canopy ** 1.35;
}

export function springLean(position, velocity, target, elapsed) {
    // Small integration steps keep the spring stable on slower displays.
    let remaining = Math.max(0, Math.min(elapsed, 64)) / 1000;
    while (remaining > 0) {
        const step = Math.min(remaining, 0.008);
        velocity += ((target - position) * 48 - velocity * 7) * step;
        position += velocity * step;
        remaining -= step;
    }
    return { position, velocity };
}

export function canopyFlutter(y, height, elapsed) {
    if (height <= 0 || elapsed <= 0 || elapsed >= 4000) return 0;
    const canopy = Math.max(0, Math.min(1, (0.88 - y / height) / 0.88));
    if (canopy === 0) return 0;
    const envelope = Math.sin(Math.PI * elapsed / 4000) * Math.exp(-elapsed / 1800);
    return Math.sin(elapsed / 180 + y / height * 9) * canopy ** 1.5 * envelope * 12;
}

export function initializeTree(header) {
    const canvas = header.querySelector('canvas');
    const image = header.querySelector('.tree-art__still');
    const context = canvas.getContext('2d');
    if (!context) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let ready = false;
    let visible = false;
    let lean = 0;
    let velocity = 0;
    let target = 0;
    let gustStarted = -Infinity;
    let gustElapsed = 4000;
    let frame = 0;
    let previousTime = 0;
    let width = 0;
    let height = 0;

    function draw() {
        if (!ready || !width || !height) return;
        context.clearRect(0, 0, width, height);
        const size = Math.min(width - 76, height);
        const left = (width - size) / 2;
        const top = height - size;
        // Thin overlapping strips bend the canopy, leaving the trunk rooted.
        for (let y = 0; y < image.naturalHeight; y += 2) {
            const strip = Math.min(2, image.naturalHeight - y);
            const offset = branchOffset(y, image.naturalHeight, lean) + canopyFlutter(y, image.naturalHeight, gustElapsed);
            context.drawImage(image, 0, y, image.naturalWidth, strip,
                left + offset, top + y / image.naturalHeight * size,
                size, strip / image.naturalHeight * size + 0.35);
        }
    }

    function stop() {
        cancelAnimationFrame(frame);
        frame = 0;
        previousTime = 0;
        lean = target = 0;
        velocity = 0;
        gustStarted = -Infinity;
        gustElapsed = 4000;
        draw();
    }

    function animate(time) {
        frame = 0;
        if (!visible || document.hidden || reducedMotion.matches) return;
        const spring = springLean(lean, velocity, target, previousTime ? time - previousTime : 16);
        lean = spring.position;
        velocity = spring.velocity;
        gustElapsed = time - gustStarted;
        previousTime = time;
        if (Math.abs(target - lean) < 0.025 && Math.abs(velocity) < 0.05) {
            lean = target;
            velocity = 0;
        }
        draw();
        if (lean !== target || gustElapsed < 4000) frame = requestAnimationFrame(animate);
        else previousTime = 0;
    }

    function schedule() {
        if (!frame && ready && visible && !document.hidden && !reducedMotion.matches) {
            frame = requestAnimationFrame(animate);
        }
    }

    function resize() {
        const bounds = canvas.parentElement.getBoundingClientRect();
        width = bounds.width;
        height = bounds.height;
        const ratio = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        draw();
    }

    function motionPreference() {
        stop();
        canvas.hidden = reducedMotion.matches || !ready;
        image.hidden = !canvas.hidden;
        resize();
    }

    function loaded() {
        if (!image.naturalWidth) return;
        ready = true;
        motionPreference();
    }

    image.addEventListener('load', loaded, { once: true });
    if (image.complete) loaded();
    new ResizeObserver(resize).observe(canvas.parentElement);
    new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (!visible) stop();
    }).observe(header);
    reducedMotion.addEventListener('change', motionPreference);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    header.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch' || reducedMotion.matches) return;
        const bounds = header.getBoundingClientRect();
        target = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1)) * 36;
        gustStarted = performance.now();
        schedule();
    }, { passive: true });
    header.addEventListener('pointerleave', () => { target = 0; schedule(); });
}

if (typeof document !== 'undefined') {
    const header = document.querySelector('.tree-header');
    if (header) initializeTree(header);
}
