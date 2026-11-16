// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../src/shared/engine/app/scopeEnvironment';
import { FailureOutbox } from '../src/client/engine/telemetry/failureEpisodes';
import { FailureTelemetry } from '../src/client/engine/telemetry/failureTelemetry';

const previousEnvironment = scopeEnvironment();
const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); installScopeEnvironment(previousEnvironment); vi.restoreAllMocks(); document.body.replaceChildren(); });
function fixture() {
  const frames = new Map<number, (time: number) => void>();
  let serial = 0;
  installScopeEnvironment({ targetKind: () => 'other', frame: callback => { frames.set(++serial, callback); return serial; }, cancelFrame: id => { frames.delete(id); } });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const page = new Scope('failure.test.page'), first = new Scope('failure.test.first'), second = new Scope('failure.test.second');
  scopes.push(page, first, second);
  const pending = new FailureOutbox(null), service = new FailureTelemetry(page, pending, 'build', 'install', () => 'fixture', async () => false);
  const root = document.createElement('div'); root.style.opacity = '1';
  const box = new DOMRect(0, 0, 20, 20);
  vi.spyOn(root, 'getClientRects').mockReturnValue({ 0: box, length: 1, item: () => box, [Symbol.iterator]: () => [box].values() });
  const frame = () => { const work = [...frames.values()]; frames.clear(); for (const callback of work) callback(0); };
  return { root, first, second, pending, service, frame };
}

test('a detached root is not a visible episode; render, repaint and owner transfer retain one outcome', () => {
  const { root, first, second, pending, service, frame } = fixture();
  service.show(first, root, 'drop reset'); frame(); service.clear(root, 'replaced');
  expect(pending.pending()).toEqual([]);
  document.body.append(root); service.show(first, root, 'drop reset'); frame();
  service.show(second, root, 'drop reset'); frame(); first.dispose();
  service.clear(root, 'recovered', first);
  expect(pending.pending()).toEqual([]);
  service.clear(root, 'recovered', second);
  expect(pending.pending()).toHaveLength(1);
  expect(pending.pending()[0]?.data).toMatchObject({ screen: 'drop', clear: 'recovered', level: 'fixture' });
});

test('pagehide ends visible time once and pageshow starts a fresh episode; refusal retains both outcomes', () => {
  const { root, first, pending, service, frame } = fixture();
  document.body.append(root); service.show(first, root, 'lost'); frame();
  window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pagehide'));
  expect(pending.pending()).toHaveLength(1);
  window.dispatchEvent(new Event('pageshow')); frame(); service.clear(root, 'dismissed');
  const outcomes = pending.pending().map(value => value.data);
  expect(outcomes.map(value => value.clear)).toEqual(['pagehide', 'dismissed']);
  expect(new Set(outcomes.map(value => value.id)).size).toBe(2);
});
