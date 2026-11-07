import { test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the original Node strict assertion semantics in this Node-only tool regression.
import assert from 'node:assert/strict';
import { installResources } from '../../../scripts/parity/resources.mjs';

test('independent listener identities survive duplicate registration and disappear on removal or once delivery', () => {
  const original = { window: globalThis.window, document: globalThis.document, canvas: globalThis.HTMLCanvasElement,
    // oxlint-disable-next-line typescript/unbound-method -- Restore the exact native prototype methods after this isolated census test.
    add: EventTarget.prototype.addEventListener, remove: EventTarget.prototype.removeEventListener };
  try {
    Reflect.set(globalThis, 'window', Object.assign(new EventTarget(), { setTimeout, setInterval, clearTimeout, clearInterval,
      requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined }));
    Reflect.set(globalThis, 'document', new EventTarget()); Reflect.set(globalThis, 'HTMLCanvasElement', class extends EventTarget {});
    installResources();
    const listener = () => undefined, external = new EventTarget();
    window.addEventListener('error', listener); window.addEventListener('error', listener);
    document.addEventListener('touchmove', listener);
    external.addEventListener('message', listener, { once: true });
    const before = window.__parityResources();
    assert.deepEqual(before.listeners, { window: 1, document: 1, canvas: 0, other: 1 });
    assert.equal(new Set(before.listenerDetails.map(row => row.id)).size, 3);
    assert.deepEqual(before.listenerDetails.map(row => [row.type, row.kind]), [['error', 'window'], ['touchmove', 'document'], ['message', 'other']]);
    window.removeEventListener('error', listener); external.dispatchEvent(new Event('message'));
    const after = window.__parityResources();
    assert.deepEqual(after.listeners, { window: 0, document: 1, canvas: 0, other: 0 });
    assert.equal(after.listenerDetails[0].id, before.listenerDetails[1].id);
    assert.match(after.listenerDetails[0].stack, /listener touchmove/u);
  } finally {
    EventTarget.prototype.addEventListener = original.add; EventTarget.prototype.removeEventListener = original.remove;
    globalThis.window = original.window; globalThis.document = original.document; globalThis.HTMLCanvasElement = original.canvas;
  }
});
