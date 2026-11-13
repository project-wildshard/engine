// @vitest-environment happy-dom
// REMOTE-PLAYERS RP11 (Jake, 2026-11-12 17:43: "it's an MMO ... everything, right?"): another player's death and return, as
// this page sees them. The server respawns a fallen player in the tick he dies (health.ts, roomRespawn.ts): his row's hp comes
// back up and his row jumps to his checkpoint at once, so the interpolator draws him sliding across the map in two frames and
// his body never falls. RP11 holds the body where it fell, lays it down, keeps it there 2 s with its Name dimmed, fades it out,
// and then fades it in at the checkpoint: no frame draws it anywhere between. A row whose hp reads 0 dies the same way, and a
// jump with no rise in hp (a teleport) only snaps.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { NetClient } from './client';
import { OtherPlayers } from './otherPlayers';
import { FADE_TIME, FALL_TIME, LIE_TIME, NAME_DIM, RISE_TIME } from './remoteDeath';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const X = column('x'), Y = column('y'), Z = column('z'), HP = column('hp');
const DT = 1 / 60;
/** Where Jimmy dies, and his checkpoint 60 m away. */
const FELL = { x: 10, z: 0 }, CHECKPOINT = { x: -40, z: 33 };

/** Jimmy at handle 2. The test sets his row's x, z and hp; a jump is drawn as the interpolator draws one, over `lerp` frames. */
function rig(): { others: OtherPlayers; scene: THREE.Scene; row: { x: number; y: number; z: number; hp: number } } {
  const row = { x: FELL.x, y: 0, z: FELL.z, hp: 60 }, scene = new THREE.Scene();
  const entities = new Map([[2, { handle: 2, id: 'player-jimmy', cls: PLAYER_CLASS, initial: { name: 'Jimmy' } }]]);
  const client = { welcome: { handle: 1 }, entities, riders: new Map(), interpolator: { sample: (_handle: number, _tick: number, out: Float64Array) => {
    out.fill(0); out[X] = row.x; out[Y] = row.y; out[Z] = row.z; out[HP] = row.hp; return true;
  } } } as unknown as NetClient;
  return { others: new OtherPlayers(client, scene, new Scope('rp11-test')), scene, row };
}

interface Look { t: number; death: string; x: number; z: number; speed: number; visible: boolean; head: number; body: number; name: number }
/** One frame on Jake's page: what `__onlinePlayers()` says, and what is drawn: the group's place, the head's height, the body's
 *  and the Name's opacity. */
function frame(r: ReturnType<typeof rig>, t: number): Look {
  r.others.frame(0, DT);
  const group = r.scene.getObjectByName('Player · Jimmy'), head = group?.getObjectByName('Head'), name = group?.getObjectByName('Name') as THREE.Sprite | undefined;
  const mesh = group?.getObjectByName('CastawayBody') as THREE.Mesh | undefined, shown = r.others.shown[0];
  if (group === undefined || head === undefined || name === undefined || mesh === undefined || shown === undefined) throw new Error('no body');
  group.updateMatrixWorld(true);
  const material = mesh.material as THREE.Material;
  return { t, death: shown.death, x: group.position.x, z: group.position.z, speed: shown.speed, visible: group.visible, head: head.getWorldPosition(new THREE.Vector3()).y,
    body: material.transparent ? material.opacity : 1, name: name.material.opacity };
}
function run(r: ReturnType<typeof rig>, seconds: number, from: number, out: Look[]): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) out.push(frame(r, from + t));
}
/** The interpolator's two frames across a jump: part of the way, then there. */
function jump(r: ReturnType<typeof rig>, to: { x: number; z: number }, hp: number, out: Look[]): void {
  const from = { x: r.row.x, z: r.row.z }, t0 = out.at(-1)?.t ?? 0;
  r.row.x = from.x + (to.x - from.x) * 0.5; r.row.z = from.z + (to.z - from.z) * 0.5; out.push(frame(r, t0 + DT));
  r.row.x = to.x; r.row.z = to.z; r.row.hp = hp; out.push(frame(r, t0 + 2 * DT));
}
const at = (look: Look, spot: { x: number; z: number }): boolean => Math.hypot(look.x - spot.x, look.z - spot.z) < 1e-6;

test('death and respawn in one tick: the body falls where he died, lies 2 s with its Name dimmed, fades, and fades in at the checkpoint without sliding', () => {
  const r = rig(), looks: Look[] = [];
  run(r, 0.5, 0, looks);
  const standing = looks.at(-1);
  expect(standing?.death, 'alive, nothing playing').toBe('');
  expect(standing?.head ?? 0).toBeGreaterThan(1.4);
  const died = looks.length;
  jump(r, CHECKPOINT, 100, looks); // the server's respawn: hp back to full and the row at his checkpoint, in one tick
  run(r, FALL_TIME + LIE_TIME + FADE_TIME + RISE_TIME + 1, 0.5, looks);
  const after = looks.slice(died);
  // No slide: every frame draws him where he fell or at the checkpoint, never between, and never faster than a run.
  for (const look of after) expect(at(look, FELL) || at(look, CHECKPOINT), `t ${look.t.toFixed(3)} at ${look.x.toFixed(2)}, ${look.z.toFixed(2)}`).toBe(true);
  for (const look of looks) expect(look.speed).toBeLessThan(20);
  const phases = after.map(look => look.death).filter((phase, i, all) => phase !== all[i - 1]);
  expect(phases, 'the jump\'s two frames hold him where he fell, then he falls').toEqual(['', 'fall', 'lie', 'fade', 'gone', 'rise', '']);
  const first = (phase: string): number => after.findIndex(look => look.death === phase);
  const lie = after.filter(look => look.death === 'lie');
  // The fall: down where he died, the head near the ground, the Name dimmed.
  expect(lie.length * DT, 'he lies 2 s').toBeCloseTo(LIE_TIME, 1);
  for (const look of lie) { expect(at(look, FELL)).toBe(true); expect(look.head).toBeLessThan(0.5); expect(look.name).toBeCloseTo(NAME_DIM, 2); expect(look.body).toBe(1); expect(look.visible).toBe(true); }
  expect(after[first('fall')]?.head ?? 0, 'the fall starts upright').toBeGreaterThan(1.2);
  // The fade: the body and its Name go out together, then nothing is drawn.
  const fade = after.filter(look => look.death === 'fade');
  expect(fade.some(look => look.body > 0.2 && look.body < 0.8), 'a fade, not a cut').toBe(true);
  expect(fade.every((look, i) => i === 0 || look.body <= (fade[i - 1]?.body ?? 1))).toBe(true);
  for (const gone of after.filter(look => look.death === 'gone')) expect(gone.visible).toBe(false);
  // The return: at the checkpoint, upright, fading in, then whole, its Name bright.
  const rise = after.filter(look => look.death === 'rise');
  for (const look of rise) { expect(at(look, CHECKPOINT)).toBe(true); expect(look.visible).toBe(true); expect(look.head).toBeGreaterThan(1.4); }
  expect(rise.some(look => look.body > 0.2 && look.body < 0.8), 'a fade in').toBe(true);
  const end = looks.at(-1);
  expect(end?.death).toBe('');
  expect(end !== undefined && at(end, CHECKPOINT)).toBe(true);
  expect(end?.body).toBe(1);
  expect(end?.name).toBe(1);
  expect(end?.head ?? 0).toBeGreaterThan(1.4);
  // Back to the shared material once whole: one draw call for every body again.
  const mesh = r.scene.getObjectByName('CastawayBody') as THREE.Mesh;
  expect((mesh.material as THREE.Material).userData['shared']).toBe(true);
});

test('a row at hp 0 falls in place and stays gone until hp comes back, then fades in where the row is', () => {
  const r = rig(), looks: Look[] = [];
  run(r, 0.3, 0, looks);
  r.row.hp = 0;
  run(r, FALL_TIME + LIE_TIME + FADE_TIME + 2, 0.3, looks);
  const dead = looks.slice(18);
  expect(dead.map(look => look.death).filter((phase, i, all) => phase !== all[i - 1])).toEqual(['fall', 'lie', 'fade', 'gone']);
  for (const look of dead) expect(at(look, FELL)).toBe(true);
  const back = looks.length;
  jump(r, CHECKPOINT, 100, looks);
  run(r, RISE_TIME + 0.5, 10, looks);
  for (const look of looks.slice(back)) expect(at(look, FELL) || at(look, CHECKPOINT)).toBe(true);
  for (const look of looks.slice(back)) if (at(look, FELL)) expect(look.visible, 'never drawn back where he fell').toBe(false);
  expect(looks.slice(back).map(look => look.death).filter((phase, i, all) => phase !== all[i - 1])).toEqual(['gone', 'rise', '']);
  for (const look of looks) expect(look.speed).toBeLessThan(20);
});

test('a jump with no rise in hp is a teleport: it snaps, with no fall and no slide', () => {
  const r = rig(), looks: Look[] = [];
  run(r, 0.3, 0, looks);
  const from = looks.length;
  jump(r, CHECKPOINT, 60, looks);
  run(r, 0.5, 0.4, looks);
  for (const look of looks.slice(from)) { expect(look.death).toBe(''); expect(at(look, FELL) || at(look, CHECKPOINT)).toBe(true); expect(look.speed).toBeLessThan(20); expect(look.visible).toBe(true); }
  expect(at(looks.at(-1) as Look, CHECKPOINT)).toBe(true);
});

test('a body first seen at hp 0 is no death (a row before its data), and a walk is no jump', () => {
  const r = rig(), looks: Look[] = [];
  r.row.hp = 0;
  run(r, 0.5, 0, looks);
  for (let i = 0; i < 60; i++) { r.row.x += 7 * DT; looks.push(frame(r, 0.5 + i * DT)); } // a run at 7 m/s
  for (const look of looks) expect(look.death).toBe('');
  expect(looks.at(-1)?.x ?? 0).toBeCloseTo(FELL.x + 7, 1);
});

test('the killing blow from full hp: hp reads 100 before and after, and the hit\'s killed lays him down where he stood', () => {
  const r = rig(), looks: Look[] = [];
  r.row.hp = 100;
  run(r, 0.3, 0, looks);
  expect(r.others.hurt(2, 120, true)).toBe(true); // the `hit` arrives as its frame is still ~100 ms ahead of the drawn row
  run(r, 0.1, 0.3, looks);
  const from = looks.length;
  jump(r, CHECKPOINT, 100, looks);
  run(r, FALL_TIME + LIE_TIME + FADE_TIME + RISE_TIME + 0.5, 0.5, looks);
  const after = looks.slice(from);
  expect(after.map(look => look.death).filter((phase, i, all) => phase !== all[i - 1])).toEqual(['fall', 'lie', 'fade', 'gone', 'rise', '']);
  for (const look of after) if (look.death !== '' && look.death !== 'rise') expect(at(look, FELL)).toBe(true);
  for (const look of looks) expect(look.speed).toBeLessThan(20);
  expect(at(looks.at(-1) as Look, CHECKPOINT)).toBe(true);
});

test('killed again while fading back in: down again where it rose, never sliding', () => {
  const r = rig(), looks: Look[] = [];
  run(r, 0.3, 0, looks);
  r.others.hurt(2, 60, true);
  jump(r, CHECKPOINT, 100, looks);
  run(r, FALL_TIME + LIE_TIME + FADE_TIME + 0.2, 0.4, looks);
  expect(looks.at(-1)?.death).toBe('rise');
  r.others.hurt(2, 100, true);
  run(r, 0.5, 4, looks);
  expect(looks.at(-1)?.death).toBe('fall');
  expect(at(looks.at(-1) as Look, CHECKPOINT)).toBe(true);
  for (const look of looks) expect(look.speed).toBeLessThan(20);
});

test('a stalled frame of healing or a fast fall is no death', () => {
  const r = rig(), looks: Look[] = [];
  run(r, 0.3, 0, looks);
  // a hitch: the row runs 5 m in one frame while 3 hp of healing land
  r.row.x += 5; r.row.hp += 3; looks.push(frame(r, 0.32));
  run(r, 0.3, 0.33, looks);
  // a long fall, 60 m/s straight down
  for (let i = 0; i < 30; i++) { r.row.y -= 1; looks.push(frame(r, 0.7 + i * DT)); }
  for (const look of looks) expect(look.death).toBe('');
  const group = r.scene.getObjectByName('Player · Jimmy');
  expect(group?.position.y, 'the falling body goes down with its row').toBeCloseTo(-30, 5);
});
