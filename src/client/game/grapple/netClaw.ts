import { Vector3 } from 'three';
import type { NetClient } from '@wildshard/engine/net/client';
import { seqAfter } from '@wildshard/engine/net/command';
import type { NetHookWire } from '@wildshard/engine/net/netPlayer';
import { GRAPPLE_PHASES, grappleRow, NO_HOOK, type GrappleClaw } from '../../../shared/game/grapple/feed';
import type { GrappleCourse, GrappleEvent, GrapplePhase, GrappleTarget, GrappleView, LockResult } from '../../../shared/game/grapple/sim';

/** The event a phase opens with, as `GrappleSim` raises it. */
const OPENS: Partial<Readonly<Record<GrapplePhase, Exclude<GrappleEvent['kind'], 'release'>>>> = { fire: 'fire', miss: 'miss', bite: 'bite', lift: 'zip', zip: 'zip', reel: 'reel', dock: 'dock' };

/** A claw on the wire: LOCK names its hook and JUMP fires, on the next command, and every phase is the server's. The aim scan
 * stays the view's, and so does the reply to a press, so a press answers the frame it is made. A `lifts` guard is the
 * server's own: the body is `led`, so nothing here steps through it. */
export function netClaw(client: NetClient, player: string, wire: NetHookWire, start: GrappleCourse): GrappleClaw {
  const missEnd = new Vector3();
  let course = start, phase: GrapplePhase = 'idle', clock = 0, target: GrappleTarget | null = null, armedMiss = false;
  let events: GrappleEvent[] = [], press: number | null = null;
  const read = (field: Parameters<typeof grappleRow>[1]): number | undefined => {
    const frame = client.latest; return frame === null ? undefined : client.stateField(frame, grappleRow(player, field));
  };
  const hookTarget = (index: number): GrappleTarget | null => {
    const hook = course.hooks[index]; return hook === undefined ? null : { hook, landing: hook, approach: hook, lifts: false };
  };
  const sync = (): void => {
    const heard = GRAPPLE_PHASES[read('phase') ?? -1];
    if (heard === undefined) return;
    clock = read('clock') ?? clock; missEnd.set(read('mx') ?? missEnd.x, read('my') ?? missEnd.y, read('mz') ?? missEnd.z);
    // what this client just pressed stands until the server has run the command that carries it
    const acked = client.latest?.lastSeq;
    if (press !== null && acked !== undefined && !seqAfter(press, acked)) press = null;
    if (press === null) {
      const hook = read('hook') ?? NO_HOOK;
      armedMiss = read('armed') === 1; target = hook === NO_HOOK ? null : hookTarget(hook);
    }
    if (heard === phase) return;
    const was = phase, opened = OPENS[heard];
    phase = heard;
    if (heard === 'idle') events.push({ kind: 'release', active: was !== 'dock' });
    else if (opened !== undefined && !(heard === 'zip' && was === 'lift')) events.push({ kind: opened }); // a lift and its zip are one pull
  };
  const busy = (): boolean => phase !== 'idle' && phase !== 'miss' && phase !== 'reel' && phase !== 'dock';
  return {
    get phase() { sync(); return phase; }, get clock() { return clock; }, get target() { return target; }, missEnd,
    get course() { return course; }, set course(value) { course = value; },
    holding: () => target !== null || armedMiss,
    guardOpen: () => false,
    drainEvents: () => { sync(); const out = events; events = []; return out; },
    lock: (_view: GrappleView, candidate: GrappleTarget | null, lockedOn: boolean): LockResult => {
      if (busy()) return 'busy';
      if (target !== null || armedMiss) { press = wire.lock(undefined); target = null; armedMiss = false; events.push({ kind: 'release', active: false }); return 'released'; }
      if (candidate === null && lockedOn) return 'pass';
      const index = candidate === null ? -1 : course.hooks.indexOf(candidate.hook);
      press = wire.lock(index < 0 ? undefined : index);
      if (candidate === null) { armedMiss = true; return 'armed'; }
      target = candidate; return 'locked';
    },
    fire: () => { if (target === null && !armedMiss) return false; if (phase === 'idle') wire.fire(); return true; },
    traverse: dt => { clock += dt; sync(); return busy(); },
    release: () => { if (target !== null || armedMiss || phase !== 'idle') press = wire.lock(undefined); target = null; armedMiss = false; events.push({ kind: 'release', active: phase !== 'idle' && phase !== 'dock' }); },
  };
}
