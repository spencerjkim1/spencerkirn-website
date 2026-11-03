import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/draw.js', import.meta.url), 'utf8');

function drawingTools() {
    function element() {
        return {
            handlers: {}, attributes: {}, value: '', disabled: false,
            addEventListener(type, handler) { this.handlers[type] = handler; },
            setAttribute(key, value) { this.attributes[key] = value; },
            querySelectorAll() { return []; },
        };
    }
    const elements = Object.fromEntries(['#draw-canvas', '#draw-status', '#draw-send', '#draw-undo', '#draw-clear', '#draw-eraser', '.drawing-desk', '#draw-size'].map((id) => [id, element()]));
    const inks = [element(), element(), element()];
    inks[0].value = '#171717';
    elements['#draw-size'].value = '7';
    const canvas = elements['#draw-canvas'];
    Object.assign(canvas, {
        width: 800, height: 500,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }),
        setPointerCapture() {},
        getContext: () => Object.fromEntries(['beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke', 'fillRect'].map((key) => [key, () => {}])),
    });
    const sandbox = vm.createContext({
        document: {
            querySelector: (selector) => selector === 'input[name="ink"]:checked' ? inks[0] : elements[selector],
            querySelectorAll: () => inks,
        },
        window: { confirm: () => true },
        fetch: async () => ({ ok: true, json: async () => ({ enabled: false }) }),
        AbortSignal,
    });
    vm.runInContext(source, sandbox);
    return {
        elements, inks,
        state: (code) => vm.runInContext(code, sandbox),
        click: (id) => elements[id].handlers.click(),
        dot() {
            canvas.handlers.pointerdown({ button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {} });
            canvas.handlers.pointerup({ pointerId: 1 });
        },
    };
}

test('eraser uses white at the selected brush size and undo restores the previous stroke history', () => {
    const tools = drawingTools();
    tools.dot();
    tools.click('#draw-eraser');
    assert.equal(tools.elements['#draw-eraser'].attributes['aria-pressed'], 'true');
    tools.elements['#draw-size'].value = '14';
    tools.dot();
    assert.equal(tools.state('strokes.at(-1).color'), '#fff');
    assert.equal(tools.state('strokes.at(-1).size'), 14);
    tools.click('#draw-undo');
    assert.equal(tools.state('strokes.length'), 1);
    assert.equal(tools.state('strokes[0].color'), '#171717');
});

test('toggling eraser off or selecting an ink color returns to drawing', () => {
    const tools = drawingTools();
    tools.click('#draw-eraser');
    tools.click('#draw-eraser');
    tools.dot();
    assert.equal(tools.state('strokes.at(-1).color'), '#171717');
    tools.click('#draw-eraser');
    tools.inks[0].value = '#a33e2c';
    tools.inks[0].handlers.change();
    tools.dot();
    assert.equal(tools.elements['#draw-eraser'].attributes['aria-pressed'], 'false');
    assert.equal(tools.state('strokes.at(-1).color'), '#a33e2c');
});

test('eraser cannot change tools while sending or during an active stroke', () => {
    const tools = drawingTools();
    tools.state('busy = true; controls()');
    assert.equal(tools.elements['#draw-eraser'].disabled, true);
    tools.click('#draw-eraser');
    assert.equal(tools.state('erasing'), false);
    tools.state('busy = false; pointer = 1; controls()');
    assert.equal(tools.elements['#draw-eraser'].disabled, true);
    tools.click('#draw-eraser');
    assert.equal(tools.state('erasing'), false);
});
