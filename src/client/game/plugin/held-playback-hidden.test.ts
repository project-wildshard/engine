import { expect, test } from 'vitest';
import { Group } from 'three';
import { HeldPlayback } from './weaponFamily';

// a stateless pose (x = the observed value), a counter with a private local (x grows by one each evaluation) and a
// visibility binding (the root shown while the observed value is positive)
const pose = { id: 'held.pose', reads: ['a'], bindings: [{ property: 'x', target: 'pose' }], nodes: [{ op: 'read', index: 0 }], channels: [{ property: 'x', value: 0 }] };
const counter = { id: 'held.count', reads: [], bindings: [{ property: 'x', target: 'count' }], locals: [{ initial: { op: 'constant', value: 0 }, next: 2 }],
  nodes: [{ op: 'local', index: 0 }, { op: 'constant', value: 1 }, { op: 'add', a: 0, b: 1 }], channels: [{ property: 'x', value: 2 }] };
const shows = { id: 'held.shows', reads: ['a'], bindings: [{ property: 'visible', target: 'shown' }], nodes: [{ op: 'read', index: 0 }], channels: [{ property: 'visible', value: 0 }] };

function rig() {
  const holster = new Group(), model = new Group(), parts = { pose: new Group(), count: new Group(), shown: new Group() };
  holster.add(model); model.add(parts.pose, parts.count, parts.shown);
  const playback = new HeldPlayback({ pose: [pose], count: [counter], shows: [shows] }, new Map<string, unknown>([['model', model], ['pose', parts.pose], ['count', parts.count], ['shown', parts.shown]]));
  return { holster, parts, playback };
}

test('T10: a hidden held model skips its stateless views; shown again, they write what they would have', () => {
  const { holster, parts, playback } = rig();
  playback.beginFrame(1 / 60); playback.apply('pose', { a: 2 });
  expect(parts.pose.position.x).toBe(2);
  holster.visible = false;
  playback.beginFrame(1 / 60); playback.apply('pose', { a: 5 });
  expect(parts.pose.position.x).toBe(2);
  holster.visible = true;
  playback.beginFrame(1 / 60); playback.apply('pose', { a: 7 });
  expect(parts.pose.position.x).toBe(7);
});

test('PF6: a view with private locals holds its state while hidden and resumes from it when shown', () => {
  const { holster, parts, playback } = rig();
  for (let i = 0; i < 3; i++) { if (i === 1) holster.visible = false; playback.beginFrame(1 / 60); playback.apply('count', {}); }
  holster.visible = true; playback.beginFrame(1 / 60); playback.apply('count', {});
  // two evaluations (the hidden two skipped): its local counted only while drawn, from where it stopped
  const shown = rig();
  for (let i = 0; i < 2; i++) { shown.playback.beginFrame(1 / 60); shown.playback.apply('count', {}); }
  expect(parts.count.position.x).toBe(shown.parts.count.position.x);
});

test('T10: a view that sets visibility is never skipped (it may be what shows the model)', () => {
  const { holster, parts, playback } = rig();
  holster.visible = false;
  playback.beginFrame(1 / 60); playback.apply('shows', { a: 0 });
  expect(parts.shown.visible).toBe(false);
  playback.beginFrame(1 / 60); playback.apply('shows', { a: 1 });
  expect(parts.shown.visible).toBe(true);
});
