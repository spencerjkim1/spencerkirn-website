import test from 'node:test';
import assert from 'node:assert/strict';
import { branchOffset, springLean, canopyFlutter } from '../assets/tree.js';

test('tree canopy bends while the trunk and ground stay anchored', () => {
    assert.equal(branchOffset(0, 480, 22), 22);
    assert.ok(branchOffset(150, 480, 22) > branchOffset(300, 480, 22));
    assert.equal(branchOffset(440, 480, 22), 0);
    assert.equal(branchOffset(480, 480, 22), 0);
    assert.equal(branchOffset(100, 0, 22), 0);
});

test('tree canopy follows either direction symmetrically', () => {
    assert.equal(branchOffset(120, 480, -22), -branchOffset(120, 480, 22));
});

test('tree spring settles back to its resting position at different frame rates', () => {
    for (const elapsed of [8, 16, 32, 64, 5000]) {
        let position = 36;
        let velocity = 0;
        for (let frame = 0; frame < 700; frame++) {
            ({ position, velocity } = springLean(position, velocity, 0, elapsed));
        }
        assert.ok(Math.abs(position) < 0.001);
        assert.ok(Math.abs(velocity) < 0.001);
    }
});

test('stronger tree sway has a natural overshoot and settles without drifting', () => {
    let position = 0;
    let velocity = 0;
    let peak = 0;
    for (let frame = 0; frame < 300; frame++) {
        ({ position, velocity } = springLean(position, velocity, 36, 16));
        peak = Math.max(peak, position);
    }
    assert.ok(peak > 36 && peak < 50);
    assert.ok(Math.abs(position - 36) < 0.001);
    assert.ok(Math.abs(velocity) < 0.001);
    assert.deepEqual(springLean(0, 0, 36, 0), { position: 0, velocity: 0 });
});

test('canopy flutter never moves the roots and ends after four seconds', () => {
    assert.notEqual(canopyFlutter(100, 480, 500), 0);
    assert.equal(canopyFlutter(440, 480, 500), 0);
    assert.equal(canopyFlutter(100, 480, 0), 0);
    assert.equal(canopyFlutter(100, 480, 4000), 0);
    assert.equal(canopyFlutter(100, 480, Infinity), 0);
});
