export const SCENARIOS = [
    { id: 'allowed', label: 'Example 01 / Allowed', end: 6, description: 'A normal request passes each check and reaches the application.', result: '200 · Request reaches the application', detail: 'All checks passed. The application receives the request.' },
    { id: 'ddos', label: 'Example 02 / DDoS attack', end: 2, description: 'Attack traffic matches a DDoS mitigation and stops at the edge.', signal: 'Attack detected → Mitigated', result: 'Mitigated · DDoS protection', detail: 'The attack stops here. Later checks and the application are not reached.' },
    { id: 'waf', label: 'Example 03 / WAF attack score 1', end: 3, description: 'Attack score: 1. An example WAF rule is configured to block that score.', signal: 'Attack score = 1 → Block', result: '403 · Blocked by WAF', detail: 'A matching rule—not the score alone—blocks this request.' },
    { id: 'bots', label: 'Example 04 / Bot score 1', end: 4, description: 'Bot score: 1. An example rule blocks likely automated traffic.', signal: 'Bot score = 1 → Block', result: '403 · Bot request blocked', detail: 'The configured bot-score rule blocks this request before it reaches the application.' },
    { id: 'russia', label: 'Example 05 / Request from Russia', end: 3, description: 'Country: Russia (RU). An example WAF rule blocks requests from RU.', signal: 'Country = RU → Block', result: '403 · Country rule matched', detail: 'This example explicitly blocks Russia. Country alone does not automatically trigger a block.' },
    { id: 'rate-limit', label: 'Example 06 / Rate limit exceeded', end: 5, description: 'Request 101 from the same IP exceeds an example limit of 100 requests per minute.', signal: '101 / 100 requests → Block', result: '429 · Too Many Requests', detail: 'The configured per-IP rate limit stops this request. The application is not reached.' },
];

const INTRO_MS = 2500;
const STEP_MS = 1000;
const HOLD_MS = 8000;

export function scenarioDuration(scenario) {
    return INTRO_MS + scenario.end * STEP_MS + HOLD_MS;
}

export function requestState(elapsed, scenario) {
    const progress = Math.max(0, Math.min(scenario.end, (elapsed - INTRO_MS) / STEP_MS));
    return { progress, stage: Math.floor(progress), complete: progress === scenario.end };
}

export function initializeRequestFlow(panel) {
    const track = panel.querySelector('.sequence-track');
    const nodes = [...track.querySelectorAll('[data-stage]')];
    const packets = [...track.querySelectorAll('.request-packet')];
    const rail = track.querySelector('.sequence-progress');
    const buttons = [...panel.querySelectorAll('.flow-scenarios button')];
    const pause = panel.querySelector('.flow-pause');
    const descriptions = nodes.map((node) => node.querySelector('.sequence-detail p'));
    const defaultDescriptions = descriptions.map((description) => description?.textContent);
    const announcement = panel.querySelector('.flow-announcement');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let scenarioIndex = 0;
    let elapsed = 0;
    let paused = false;
    let visible = false;
    let frame = 0;
    let previousTime = null;
    let positions = [];
    let lastStage = -1;
    let lastComplete = null;

    function measure() {
        const top = track.getBoundingClientRect().top;
        positions = nodes.map((node) => {
            const box = node.querySelector('.sequence-marker').getBoundingClientRect();
            return box.top + box.height / 2 - top;
        });
        rail.style.top = `${positions[0]}px`;
        rail.style.height = `${positions.at(-1) - positions[0]}px`;
        render();
    }

    function interpolate(progress) {
        const lower = Math.floor(progress);
        const upper = Math.min(nodes.length - 1, lower + 1);
        return positions[lower] + (positions[upper] - positions[lower]) * (progress - lower);
    }

    function render() {
        if (!positions.length) return;
        const scenario = SCENARIOS[scenarioIndex];
        const state = requestState(reducedMotion.matches ? scenarioDuration(scenario) : elapsed, scenario);
        const position = interpolate(state.progress);
        rail.style.transform = `scaleY(${(position - positions[0]) / (positions.at(-1) - positions[0])})`;
        packets.forEach((packet) => {
            const delay = Number(packet.dataset.delay);
            const sample = requestState(elapsed - delay, scenario);
            packet.hidden = reducedMotion.matches || elapsed < INTRO_MS + delay || state.complete;
            packet.style.transform = `translate3d(0, ${interpolate(sample.progress) - (delay ? 2.5 : 4.5)}px, 0)`;
        });
        if (state.stage === lastStage && state.complete === lastComplete) return;
        lastStage = state.stage;
        lastComplete = state.complete;
        nodes.forEach((node, index) => {
            node.classList.toggle('is-passed', index < state.stage);
            node.classList.toggle('is-current', index === state.stage);
            node.classList.toggle('is-unreached', state.complete && index > scenario.end);
        });
        descriptions.forEach((description, index) => {
            if (description) description.textContent = state.complete && index === scenario.end && scenario.signal ? scenario.signal : defaultDescriptions[index];
        });
        panel.querySelector('.flow-result-label').textContent = state.complete ? scenario.result : `Evaluating · ${nodes[state.stage].querySelector('h4')?.textContent || 'HTTP Request'}`;
        panel.querySelector('.flow-result-description').textContent = state.complete ? scenario.detail : 'The request moves through each check until it passes or is stopped.';
    }

    function select(index, manual = false) {
        scenarioIndex = index;
        elapsed = 0;
        lastStage = -1;
        lastComplete = null;
        const scenario = SCENARIOS[index];
        panel.dataset.scenario = scenario.id;
        panel.querySelector('.flow-example-label').textContent = scenario.label;
        panel.querySelector('.flow-example-description').textContent = scenario.description;
        buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.scenario === scenario.id)));
        if (manual) announcement.textContent = `${scenario.description}${reducedMotion.matches ? ` ${scenario.result}.` : ''}`;
        measure();
    }

    function stop() {
        cancelAnimationFrame(frame);
        frame = 0;
        previousTime = null;
        panel.dataset.running = 'false';
    }

    function tick(time) {
        frame = 0;
        if (previousTime !== null) elapsed += Math.min(time - previousTime, 100);
        previousTime = time;
        if (elapsed >= scenarioDuration(SCENARIOS[scenarioIndex])) select((scenarioIndex + 1) % SCENARIOS.length);
        render();
        frame = requestAnimationFrame(tick);
    }

    function synchronize() {
        stop();
        pause.disabled = reducedMotion.matches;
        pause.textContent = reducedMotion.matches ? 'Reduced motion' : paused ? 'Play' : 'Pause';
        pause.setAttribute('aria-label', reducedMotion.matches ? 'Animation disabled by reduced-motion preference' : paused ? 'Play request animation' : 'Pause request animation');
        if (visible && !document.hidden && !paused && !reducedMotion.matches) {
            panel.dataset.running = 'true';
            frame = requestAnimationFrame(tick);
        }
        render();
    }

    buttons.forEach((button) => {
        button.disabled = false;
        button.addEventListener('click', () => {
            select(SCENARIOS.findIndex((scenario) => scenario.id === button.dataset.scenario), true);
            synchronize();
        });
    });
    pause.addEventListener('click', () => {
        paused = !paused;
        announcement.textContent = paused ? 'Request animation paused.' : 'Request animation playing.';
        synchronize();
    });
    new ResizeObserver(measure).observe(track);
    new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        synchronize();
    }).observe(panel);
    document.addEventListener('visibilitychange', synchronize);
    reducedMotion.addEventListener('change', () => { lastStage = -1; synchronize(); });
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', synchronize);
    select(0);
    synchronize();
}

if (typeof document !== 'undefined') {
    const panel = document.querySelector('.flow-panel');
    if (panel) initializeRequestFlow(panel);
}
