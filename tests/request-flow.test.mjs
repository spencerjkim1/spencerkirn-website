import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENARIOS, requestState, scenarioDuration } from '../assets/request-flow.js';

test('animated examples cover allowed requests, DDoS, WAF, bots, a Russia country rule and rate limiting', () => {
    assert.deepEqual(SCENARIOS.map((scenario) => scenario.id), ['allowed', 'ddos', 'waf', 'bots', 'russia', 'rate-limit']);
    assert.deepEqual(SCENARIOS.map((scenario) => scenario.end), [6, 2, 3, 4, 3, 5]);
    assert.match(SCENARIOS[2].description, /rule is configured to block/);
    assert.match(SCENARIOS[2].detail, /not the score alone/);
    assert.match(SCENARIOS[3].signal, /Bot score = 1/);
    assert.match(SCENARIOS[3].detail, /configured bot-score rule/);
    assert.match(SCENARIOS[4].signal, /Country = RU/);
    assert.match(SCENARIOS[4].detail, /does not automatically/);
    assert.match(SCENARIOS[5].description, /Request 101 from the same IP.*example limit of 100 requests per minute/);
    assert.equal(SCENARIOS[5].result, '429 · Too Many Requests');
    assert.match(SCENARIOS[5].detail, /application is not reached/);
});

test('every example terminates at the correct simplified stage and has a selector', async () => {
    const html = await readFile(new URL('../demo.html', import.meta.url), 'utf8');
    const stages = [...html.matchAll(/data-stage="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(stages, ['request', 'general', 'ddos', 'waf', 'bots', 'rate-limit', 'application']);
    const endings = { allowed: 'application', ddos: 'ddos', waf: 'waf', bots: 'bots', russia: 'waf', 'rate-limit': 'rate-limit' };
    for (const scenario of SCENARIOS) {
        assert.equal(stages[scenario.end], endings[scenario.id]);
        assert.ok(html.includes(`data-scenario="${scenario.id}" aria-pressed=`));
    }
});

test('requests start at the incoming node and never progress past the scenario outcome', () => {
    for (const scenario of SCENARIOS) {
        assert.deepEqual(requestState(-1000, scenario), { progress: 0, stage: 0, complete: false });
        const finished = requestState(scenarioDuration(scenario), scenario);
        assert.deepEqual(finished, { progress: scenario.end, stage: scenario.end, complete: true });
        assert.deepEqual(requestState(1000000, scenario), finished);
    }
});

test('packet travel is continuous, monotonic and includes a readable hold at the outcome', () => {
    for (const scenario of SCENARIOS) {
        let previous = 0;
        for (let elapsed = 0; elapsed <= scenarioDuration(scenario); elapsed += 16) {
            const state = requestState(elapsed, scenario);
            assert.ok(state.progress >= previous);
            assert.ok(state.progress <= scenario.end);
            assert.ok(state.progress - previous <= 16 / 1000 + 1e-10);
            previous = state.progress;
        }
        assert.equal(requestState(2499, scenario).progress, 0);
        assert.equal(requestState(3000, scenario).progress, 0.5);
        const outcomeTime = scenarioDuration(scenario) - 8000;
        assert.equal(requestState(outcomeTime - 1, scenario).complete, false);
        assert.equal(requestState(outcomeTime, scenario).complete, true);
        assert.equal(requestState(scenarioDuration(scenario) - 1, scenario).complete, true);
        assert.ok(scenarioDuration(scenario) >= 12500);
    }
});
