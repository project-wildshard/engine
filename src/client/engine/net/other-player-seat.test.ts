// @vitest-environment happy-dom
// MIRROR-SALT-ZONE MSZ10: another player in a vehicle's seat sits in it. The row moves with the vehicle at its speed, yet the
// body never walks: a `sit` seat bends its thighs and knees with its hips on the seat's base, a `stand` seat (the land-sail's)
// keeps its legs; both reach forward to the controls and face the vehicle's heading, wherever the player looks.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { NetClient } from './client';
import { OtherPlayers, type OtherSeat } from './otherPlayers';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const X = column('x'), YAW = column('yaw');
/** A client with this page at handle 1 and Jimmy at 2, his row driven along x at 15 m/s, looking off to the side. */
function driving(): { client: NetClient; step: () => void } {
  let x = 0;
  const entities = new Map([[2, { handle: 2, id: 'player-jimmy', cls: PLAYER_CLASS, initial: { name: 'Jimmy' } }]]);
  const client = { welcome: { handle: 1 }, entities, riders: new Map(), interpolator: { sample: (_handle: number, _tick: number, row: Float64Array) => { row.fill(0); row[X] = x; row[YAW] = 2.5; return true; } } } as unknown as NetClient;
  return { client, step: () => { x += 15 / 60; } };
}
const bone = (scene: THREE.Object3D, name: string): THREE.Object3D => { const found = scene.getObjectByName(name); if (found === undefined) throw new Error(`no ${name}`); return found; };
/** How far a bone turned from where it stood at `rest` (radians). */
const turned = (node: THREE.Object3D, rest: THREE.Quaternion): number => node.quaternion.angleTo(rest);

test.each<OtherSeat['pose']>(['sit', 'stand'])('a %s seat: no walk at the vehicle\'s speed, facing its heading, hands forward', pose => {
  const scene = new THREE.Scene(), scope = new Scope(`msz10-${pose}`), { client, step } = driving(), others = new OtherPlayers(client, scene, scope);
  let seat: OtherSeat | null = null;
  others.seats = id => (id === 'player-jimmy' ? seat : null);
  others.frame(0, 1 / 60);
  const group = bone(scene, 'Player · Jimmy'), thigh = bone(group, 'LeftThigh'), arm = bone(group, 'RightUpperArm'); // not the warm body's
  const restThigh = thigh.quaternion.clone(), restArm = arm.quaternion.clone();
  seat = { yaw: 0.4, pose };
  for (let i = 0; i < 60; i++) { step(); others.frame(i, 1 / 60); }
  const [shown] = others.shown;
  expect(shown?.seated).toBe(pose);
  expect(shown?.gait).toBe('idle'); // the row goes 15 m/s, the legs never stride
  expect(shown?.item).toBe('');
  expect(group.rotation.y).toBeCloseTo(0.4 + Math.PI, 9); // the vehicle's heading, not the row's look (2.5)
  expect(turned(arm, restArm)).toBeGreaterThan(0.5);
  const figure = bone(group, 'Castaway');
  if (pose === 'sit') { expect(turned(thigh, restThigh)).toBeGreaterThan(1.3); expect(figure.position.y).toBeLessThan(-0.5); }
  else { expect(turned(thigh, restThigh)).toBeLessThan(0.3); expect(Math.abs(figure.position.y)).toBeLessThan(0.05); }
  seat = null; // out of the seat, the same row walks again
  for (let i = 0; i < 30; i++) { step(); others.frame(60 + i, 1 / 60); }
  expect(others.shown[0]?.seated).toBe('');
  expect(others.shown[0]?.gait).not.toBe('idle');
  scope.dispose();
});
