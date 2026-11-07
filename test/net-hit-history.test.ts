// oxlint-disable-next-line import/no-nodejs-modules -- The sim needs the real physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
import { hitHistoryOf } from '../src/server/engine/combat/rewind';
import { CommandQueue } from '../src/server/engine/net/commandQueue';
import { HIT_HISTORY_BYTES, REWIND_TICKS, type HitHistory } from '../src/server/engine/net/hitHistory';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E5.3-G1 (J50): where a hittable stood on every tick the cap reaches, read beside the sim and never written into it.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const X_PER_TICK = 0.1, YAW_PER_TICK = 0.05;
/** A host whose one body has crossed at 6 m/s for `ticks`, turning as it goes. */
function crossed(ticks: number): { host: SimHost; history: HitHistory; id: string } {
  const host = createSimHost({ ...SIM_LEVEL, quests: [] }, { rapier }), id = [...host.entities.keys()][0], body = host.entities.get(id ?? '');
  if (id === undefined || body === undefined) throw new Error('The fixture has a body');
  body.harnessHold = true; new SimNetWorld(host);
  const history = hitHistoryOf(host); if (history === undefined) throw new Error('A room keeps a history');
  for (let at = 0; at < ticks; at++) { body.position.x = (host.state.tick + 1) * X_PER_TICK; body.yaw = (host.state.tick + 1) * YAW_PER_TICK; host.step(); }
  return { host, history, id };
}

test('a body reads where it stood on every held tick, turned as it was then', () => {
  const { host, history, id } = crossed(40), live = host.entities.get(id), now = host.state.tick;
  if (live === undefined) throw new Error('The body is gone');
  const rear = new Vector3(), front = new Vector3(), head = new Vector3(), liveHead = live.headWorld(new Vector3());
  for (let back = 1; back <= REWIND_TICKS; back++) {
    const past = now - back, seen = history.at(past)?.[0];
    if (seen === undefined) throw new Error(`No row ${String(past)}`);
    expect(seen.position.x).toBeCloseTo(past * X_PER_TICK, 4); expect(seen.position.z).toBeCloseTo(live.position.z, 6);
    seen.headWorld(head); seen.bodyCapsule(rear, front);
    // a turned body's head is where its own yaw put it, not where today's yaw would
    const reach = live.dims.bodyHalfLen * live.scale, yaw = past * YAW_PER_TICK;
    expect(head.x).toBeCloseTo(past * X_PER_TICK + Math.sin(yaw) * reach, 3); expect(head.z).toBeCloseTo(live.position.z + Math.cos(yaw) * reach, 3);
    expect(head.y).toBeCloseTo(liveHead.y, 6);
    expect(rear.clone().add(front).multiplyScalar(0.5).x).toBeCloseTo(past * X_PER_TICK, 3);
    // a contact goes back to the same place on the living body
    const there = seen.present(head, new Vector3());
    expect(there.distanceTo(liveHead)).toBeCloseTo(0, 3);
  }
  host.dispose();
});

test('a view is unwrapped from 16 bits and clamped to the cap', () => {
  const { host, history } = crossed(40), now = host.state.tick;
  expect(history.tickOf(0)).toBeNull();
  expect(history.tickOf(now)).toBeNull();
  expect(history.tickOf(now + 3)).toBeNull();
  expect(history.tickOf(now - 5)).toBe(now - 5);
  expect(history.tickOf(now - REWIND_TICKS)).toBe(now - REWIND_TICKS);
  expect(history.tickOf(now - REWIND_TICKS - 1)).toBe(now - REWIND_TICKS);
  expect(history.tickOf(now - 30)).toBe(now - REWIND_TICKS);
  // ticks are 32 bits and the wire's are 16
  host.state.tick = 0x10000 + 3;
  expect(history.tickOf(0xfffe)).toBe(0x10000 - 2);
  expect(history.tickOf(1)).toBe(0x10000 + 1);
  host.state.tick = now; host.dispose();
});

test('a body with fewer rows than the view reads its first; history moves nothing and costs what §6.2 budgets', () => {
  const { host, history, id } = crossed(3), live = host.entities.get(id), now = host.state.tick;
  if (live === undefined) throw new Error('The body is gone');
  expect(history.at(now - REWIND_TICKS)?.[0]?.position.x).toBeCloseTo(X_PER_TICK, 4);
  const at = live.position.clone(), rear = new Vector3(), front = new Vector3();
  live.bodyCapsule(rear, front); const shape = [rear.clone(), front.clone()];
  for (const row of history.at(now - 2) ?? []) { row.bodyCapsule(rear, front); row.headWorld(rear); }
  live.bodyCapsule(rear, front);
  expect(live.position).toEqual(at); expect([rear, front]).toEqual(shape);
  // 64 bodies: §6.2 estimated 18 KB
  expect(HIT_HISTORY_BYTES * 64).toBeLessThan(18 * 1024); expect(history.bytes).toBe(HIT_HISTORY_BYTES);
  host.dispose();
});

test('a held tick claims no view: its command is not what the client saw then', () => {
  const queue = new CommandQueue();
  queue.admit([{ seq: 1, viewTick: 9, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }]);
  expect(queue.next().command?.viewTick).toBe(9);
  expect(queue.next().command?.viewTick).toBe(0);
});
