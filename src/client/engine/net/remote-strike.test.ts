// @vitest-environment happy-dom
// REMOTE-PLAYERS RP7 (Jake, 2026-11-12: "I need to see attack animation"): another player's body swings when its row's swing
// count (RP6) changes: a tap or a heavy strike on the right arm and spine, on the first-person sword's timings, or a draw and
// loose when it holds a bow. The count is not saved, so the first value a page sees is where it starts, not a swing; it wraps
// at 255 to 0, and an older server that sends none means no swings at all. The legs stay the gait's. Before RP7 a swing showed
// nothing on anyone else's screen.
import * as THREE from 'three';
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { NetClient } from './client';
import { heldOnOthers, slotKit } from './heldOnOthers';
import { OtherPlayers } from './otherPlayers';
import { SwingCount } from './remoteStrike';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const SWING = column('swing'), HEAVY = column('heavy'), HELD = column('held');
const DT = 1 / 60;

let unlend: () => void = () => undefined;
afterEach(() => { unlend(); unlend = () => undefined; });

/** Jimmy at handle 2, standing at the origin facing +z on screen, his row's swing count, heavy bit and slot as the test sets. */
function swinger(): { others: OtherPlayers; scene: THREE.Scene; scope: Scope; row: { swing: number; heavy: number; held: number } } {
  const row = { swing: 7, heavy: 0, held: 0 }, scene = new THREE.Scene(), scope = new Scope('rp7-test');
  const entities = new Map([[2, { handle: 2, id: 'player-jimmy', cls: PLAYER_CLASS, initial: { name: 'Jimmy' } }]]);
  const client = { welcome: { handle: 1 }, entities, riders: new Map(), interpolator: { sample: (_handle: number, _tick: number, out: Float64Array) => { out.fill(0); out[SWING] = row.swing; out[HEAVY] = row.heavy; out[HELD] = row.held; return true; } } } as unknown as NetClient;
  return { others: new OtherPlayers(client, scene, scope), scene, scope, row };
}
const bone = (scene: THREE.Scene, name: string): THREE.Object3D => { const found = scene.getObjectByName('Player · Jimmy')?.getObjectByName(name); if (found === undefined) throw new Error(`no ${name}`); return found; };
/** The sword's tip (0.8 m up the right grip) from the right shoulder, in the figure's own space. */
function blade(scene: THREE.Scene): THREE.Vector3 {
  const figure = bone(scene, 'Castaway'); figure.updateMatrixWorld(true);
  const tip = bone(scene, 'RightHandMount').localToWorld(new THREE.Vector3(0, 0.8, 0)), shoulder = bone(scene, 'RightUpperArm').getWorldPosition(new THREE.Vector3());
  return figure.worldToLocal(tip).sub(figure.worldToLocal(shoulder)).normalize();
}
/** Frames for `seconds`: each one's attack as `__onlinePlayers()` reports it, and the blade. */
function play(rig: ReturnType<typeof swinger>, seconds: number): { attack: string; blade: THREE.Vector3 }[] {
  const out: { attack: string; blade: THREE.Vector3 }[] = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) { rig.others.frame(0, DT); out.push({ attack: rig.others.shown[0]?.attack ?? '?', blade: blade(rig.scene) }); }
  return out;
}
/** How far the blade travels over some frames, in radians. */
const arc = (frames: readonly { blade: THREE.Vector3 }[]): number => frames.reduce((sum, frame, at) => at === 0 ? 0 : sum + frame.blade.angleTo(frames[at - 1]?.blade ?? frame.blade), 0);

test('a swing is a change of the count: the first value seen is a baseline, it wraps at 255 to 0, and none is no data', () => {
  const count = new SwingCount();
  expect(count.see(Number.NaN), 'an older server sends none').toBe(false);
  expect(count.see(41), 'the first value seen is where it starts').toBe(false);
  expect(count.see(41)).toBe(false);
  expect(count.see(42)).toBe(true);
  expect(count.see(Number.NaN), 'a missing value is not a swing').toBe(false);
  expect(count.see(42), 'and keeps the count it had').toBe(false);
  expect(count.see(255)).toBe(true);
  expect(count.see(0), 'wraps').toBe(true);
  expect(count.see(0)).toBe(false);
});

test('Jimmy taps: a new count plays the tap, the sword mid-arc 150 ms in, then he is back to his gait', () => {
  const rig = swinger();
  try {
    const before = play(rig, 0.5);
    expect(new Set(before.map(frame => frame.attack)), 'his first count is a baseline, not a swing').toEqual(new Set(['']));
    const rest = before.at(-1)?.blade ?? new THREE.Vector3();
    rig.row.swing = 8;
    const strike = play(rig, 0.9);
    expect(strike[0]?.attack).toBe('tap');
    const mid = strike[Math.round(0.15 / DT) - 1];
    expect(mid?.attack).toBe('tap');
    expect(mid?.blade.angleTo(rest) ?? 0, 'the sword is out of its rest 150 ms in').toBeGreaterThan(0.6);
    expect(strike.at(-1)?.attack, 'done').toBe('');
    expect(strike.at(-1)?.blade.angleTo(rest) ?? 1, 'and back at rest').toBeLessThan(0.02);
  } finally { rig.scope.dispose(); }
});

test('a heavy strike is wider than a tap, and the count wrapping from 255 to 0 is a swing', () => {
  const rig = swinger();
  try {
    rig.row.swing = 254; play(rig, 0.2);
    rig.row.swing = 255;
    const tap = play(rig, 0.8);
    rig.row.swing = 0; rig.row.heavy = 1;
    const heavy = play(rig, 1);
    expect(tap[0]?.attack).toBe('tap');
    expect(heavy[0]?.attack, 'the count wrapped to 0: a swing, and the heavy bit says which').toBe('heavy');
    expect(heavy[Math.round(0.15 / DT) - 1]?.attack).toBe('heavy');
    // the arc from the windup to the end of the slash (SweptMelee's tap 0.07 to 0.235 s, heavy 0.06 to 0.30 s)
    const tapArc = arc(tap.slice(Math.round(0.07 / DT), Math.round(0.235 / DT))), heavyArc = arc(heavy.slice(Math.round(0.06 / DT), Math.round(0.3 / DT)));
    expect(tapArc, 'a tap sweeps the sword').toBeGreaterThan(1);
    expect(heavyArc, 'the heavy sweeps wider').toBeGreaterThan(tapArc * 1.3);
  } finally { rig.scope.dispose(); }
});

test('a swing over a swing winds up from where the arm is, not from the gait: no snap back to rest between combo swings', () => {
  const rig = swinger();
  try {
    play(rig, 0.2);
    rig.row.swing = 8;
    const first = play(rig, 0.3);
    rig.row.swing = 9;
    const second = play(rig, 0.1), last = first.at(-1)?.blade ?? new THREE.Vector3();
    expect(second[0]?.attack).toBe('tap');
    // the restart frame stays where the first swing left the blade, then winds up over the next frames
    expect(second[0]?.blade.angleTo(last) ?? 1, 'the restart frame').toBeLessThan(0.05);
  } finally { rig.scope.dispose(); }
});

test('with a bow in hand a swing is a draw and a loose: the bow arm out, the string hand back to the face; the legs are the gait\'s', () => {
  const bow = new THREE.Group(), limb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.2, 0.04), new THREE.MeshBasicMaterial());
  limb.name = 'bow'; bow.add(limb);
  unlend = heldOnOthers.lend(slotKit(() => new Map([['weapon.bow', 0]]), () => ({ row: 'weapon.bow', model: bow, bow: true })));
  const rig = swinger();
  try {
    play(rig, 0.3);
    const legs = ['LeftThigh', 'RightThigh', 'LeftShin', 'RightShin'].map(name => bone(rig.scene, name).quaternion.clone());
    const figure = bone(rig.scene, 'Castaway'), at = (name: string): THREE.Vector3 => { figure.updateMatrixWorld(true); return figure.worldToLocal(bone(rig.scene, name).getWorldPosition(new THREE.Vector3())); };
    rig.row.swing = 8;
    let drawn = false, still = true;
    for (let t = 0; t < 0.9; t += DT) {
      rig.others.frame(0, DT);
      const shown = rig.others.shown[0];
      if (t < 0.4) expect(shown?.attack).toBe('draw');
      // at full draw: the bow hand out at shoulder height in front, the string hand drawn back near the face
      const bowHand = at('LeftHand'), stringHand = at('RightHand'), shoulder = at('LeftUpperArm');
      if (bowHand.z > 0.45 && Math.abs(bowHand.y - shoulder.y) < 0.2 && stringHand.y > 1.3 && stringHand.z < bowHand.z - 0.3) drawn = true;
      for (const [index, name] of ['LeftThigh', 'RightThigh', 'LeftShin', 'RightShin'].entries()) if (bone(rig.scene, name).quaternion.angleTo(legs[index] ?? new THREE.Quaternion()) > 1e-6) still = false;
    }
    expect(drawn, 'he draws the bow').toBe(true);
    expect(still, 'his legs are the gait\'s (standing)').toBe(true);
    expect(rig.others.shown[0]?.attack).toBe('');
  } finally { rig.scope.dispose(); }
});
