import { expect, test } from 'vitest';
import { Group } from 'three';
import { HeldPlayback } from './weaponFamily';

const input = [{ input: 'a', owner: 'visual', path: ['current', 'value'] }];
function rig() {
  const model = new Group(), part = new Group(); model.add(part);
  const program = { id: 'held.input', reads: ['a'], nodes: [{ op: 'read', index: 0 }],
    channels: [{ property: 'x', value: 0 }], bindings: [{ property: 'x', target: 'part' }] };
  const playback = new HeldPlayback({ pose: [program] }, new Map<string, unknown>([['model', model], ['part', part]]));
  return { model, part, playback };
}

test('prebound held readers follow replaced owners and intermediates, retaining signed zero and refusals', () => {
  const { playback, part } = rig(), owner = { current: { value: 2 } }, owners = new Map<string, unknown>([['visual', owner]]);
  playback.bindInputs('pose', input, owners); playback.apply('pose', {}); expect(part.position.x).toBe(2);
  owner.current = { value: -0 }; playback.apply('pose', {}); expect(Object.is(part.position.x, -0)).toBe(true);
  owners.set('visual', { current: { value: 7 } }); playback.apply('pose', {}); expect(part.position.x).toBe(7);
  owners.set('visual', { current: { value: Number.NaN } });
  expect(() => playback.apply('pose', {})).toThrow(); expect(part.position.x).toBe(7);
  owners.delete('visual'); expect(() => playback.apply('pose', {})).toThrow('Missing borrowed owner');
  expect(() => playback.bindInputs('pose', input, owners)).toThrow('already bound');
});

test('explicit observations keep precedence and borrowed getters remain fresh only when consumed', () => {
  const { playback, part, model } = rig(); let calls = 0;
  const owners = new Map<string, unknown>([['visual', { current: { get value() { return ++calls; } } }]]);
  playback.bindInputs('pose', input, owners); calls = 0;
  playback.apply('pose', { a: 9 }); expect(calls).toBe(0); expect(part.position.x).toBe(9);
  playback.apply('pose', {}); playback.apply('pose', {}); expect(calls).toBe(2); expect(part.position.x).toBe(2);
  model.visible = false; playback.apply('pose', {}); expect(calls).toBe(2);
  model.visible = true; playback.apply('pose', {}); expect(calls).toBe(3); expect(part.position.x).toBe(3);
});

test('binding during an observation read is visible to its original fallback in that same evaluation', () => {
  const { playback, part } = rig(), owners = new Map<string, unknown>([['visual', { current: { value: 6 } }]]);
  const observation: Record<string, number> = {};
  Object.defineProperty(observation, 'a', { get: () => { playback.bindInputs('pose', input, owners); return undefined; } });
  playback.apply('pose', observation);
  expect(part.position.x).toBe(6);
});
