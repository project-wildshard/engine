import * as v from 'valibot';
import { Quaternion, Vector3 } from 'three';
import { parseNativeSweptMeleeBinding } from '@wildshard/format/items';
import { pickLunge, targetRadius } from '@wildshard/engine/combat/lungeTarget';
import { lineOfSight } from '@wildshard/engine/physics/query';
import { BladeSweep, bladeInReach, sweptBladeDirs, type BladeSwing, type SweptBladeRig } from '@wildshard/engine/combat/sweptBlade';
import { SweptBasePose } from '@wildshard/engine/combat/sweptBasePose';
import { SweptMeleeCore, sweptLunge, sweptMoveDamage, sweptStrikeDirection, sweptStrikePush } from '@wildshard/engine/combat/sweptMeleeCore';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { STARTER_BLADE } from '../../../shared/game/weapons/starterMoves';
import { seenBodies, seenRay, type SeenHit } from './nativeRewind';
import { playerSeats } from './playerSeats';
import { createNativeLoadout, createNativeTargetQueries } from './simulation';

/** One player's input for this tick; target selection remains with the entered runtime. */
export interface NativeSweptMeleeInput {
  readonly attack: string | null; readonly heavy: boolean; readonly heavyTarget: string | null;
  /** The press or hold names no target (P1-E3.2): the server finds the body with the page's own lunge pick. */
  readonly swing?: boolean;
  /** The look this command sent, or null for one that carries none: a recorded tape's named attack. A look can pose a blade. */
  readonly pitch?: number | null;
  readonly sprint?: boolean;
  /** The command `seq` a swing started here confirms (J47); 0 off the wire. */
  readonly seq?: number;
  /** The tick this command saw the world at (J50); 0 or absent rewinds nothing. */
  readonly viewTick?: number;
}
type NativeSweptActor = NonNullable<ReturnType<SimHost['entities']['get']>>;
/** Borrowed world reactions for swept phases; no secondary clock or body service is installed. */
export interface NativeSweptMeleePorts {
  readonly input: (player: PlayerSim, first: boolean) => NativeSweptMeleeInput; readonly alarm: () => void;
  readonly staggered: (actor: NativeSweptActor, strength: number, running: boolean) => void;
  /** The blade's poses; the starter sword's unless the kit brings its own. */
  readonly blade?: SweptBladeRig;
}
/** The lead's swept weapon. */
export interface NativeSweptMeleeOwner {
  readonly held: () => number; readonly equip: (slot: number) => void; readonly equipFor: (player: PlayerSim, slot: number) => void;
  readonly swings: () => number; readonly hits: () => number;
}

const finite = v.pipe(v.number(), v.finite()), count = v.pipe(finite, v.integer(), v.minValue(0));
const clockSaved = v.strictObject({ move: v.nullable(count), swingT: finite, comboIdx: count, lastSwingEnd: finite, cooldown: finite, charging: v.boolean(), chargeT: finite,
  releaseQueued: v.boolean(), chargePending: v.boolean(), heldPrev: v.boolean(), time: finite });
const bladeSaved = v.strictObject({ pose: v.strictObject({ from: v.array(finite), base: v.array(finite), chargeBlend: finite, sprintBlend: finite }),
  grip: v.tuple([finite, finite, finite]), tip: v.tuple([finite, finite, finite]), have: v.boolean(), struck: v.array(v.string()), pitch: finite });

/** A blade the server poses, once its player's commands carry a look: the page's `BladeSweep` over the page's swing keys. */
interface LiveBlade { readonly pose: SweptBasePose; readonly sweep: BladeSweep; readonly struck: string[]; pitch: number }

/**
 * P1-E3.5: the swept family, a seat per player. SweptMeleeCore remains the single combo/charge clock; a seat binds native rows
 * and target queries to one player, whose hits are its own. A command that carries a look (or swings at nothing) poses
 * the blade from the page's keys and sweeps it (P1-E3.2 follow-up): every body the page's `BladeSweep` would strike, up to the
 * profile's `maxHits`. A recorded tape's named attack has no look to pose a blade with, so it still lands on its one body.
 */
export function installNativeSweptMelee(host: SimHost, items: readonly unknown[], input: unknown, ports: NativeSweptMeleePorts): NativeSweptMeleeOwner {
  const { row, profiles } = parseNativeSweptMeleeBinding(input, items);
  type Profile = typeof profiles[number]; type Move = Profile['moves']['heavy'];
  const rig = ports.blade ?? STARTER_BLADE, slots = profiles.map((_profile, index) => index);
  const swingOf = (profile: Profile, move: Move): BladeSwing => {
    const at = profile.moves.combo.indexOf(move), swing = at === -1 ? rig.heavy : rig.combo[at];
    if (swing === undefined) throw new Error('Swept kit has more moves than its blade poses');
    return { keys: swing.keys, total: move.total };
  };
  const yAxis = new Vector3(0, 1, 0), queries = createNativeTargetQueries<NativeSweptActor>({ fore: false }), rays = createNativeTargetQueries<NativeSweptActor>();
  const roster: NativeSweptActor[] = [];
  const bodies = (): NativeSweptActor[] => { roster.length = 0; for (const body of host.entities.values()) roster.push(body); return roster; };
  const seats = playerSeats(host, (player, first) => {
    const loadout = createNativeLoadout(row.selection ?? { slots, initial: row.initial, lower: 0, raise: 0 }, { owned: () => true, locked: () => false });
    const state = { queued: false, struck: false, opened: false, windows: 0, target: null as string | null, aimed: false, swings: 0, hits: 0 };
    /** Whether this seat's swing is the one the wire shows. */
    let showing = false;
    /** The swing's command seq, a queued tap's until it chains, and whether a tap is pressing right now. */
    const seq = { swing: 0, queued: 0, chained: null as number | null, pressing: false };
    let blade: LiveBlade | null = null, current: NativeSweptMeleeInput = { attack: null, heavy: false, heavyTarget: null };
    /** The body a free swing takes: the page's `findLunge`, unlocked. A move past its reach after the dash lands on nothing. */
    const aimedBody = (profile: Profile, move: Move): string | null => {
      const seen = seenBodies(host, current.viewTick), range = move === profile.moves.heavy ? profile.lunge.heavyRange : profile.lunge.range, { cone } = profile.lunge;
      return (seen === null ? pickLunge(host.entities.values(), player.position, player.yaw, range, cone) : pickLunge(seen, player.position, player.yaw, range, cone))?.entityId ?? null;
    };
    const lunge = (profile: Profile, move: Move): void => {
      const actor = state.target === null ? undefined : host.entities.get(state.target), at = player.position;
      if (actor === undefined || !actor.alive) return;
      // the dash goes where this command saw the body, so the client that predicted it dashes the same (P1-E5.3-E2)
      const spot = seenBodies(host, current.viewTick)?.find(seen => seen.body === actor)?.position ?? actor.position;
      if (Math.abs(spot.y - at.y) > row.lunge.maxHeight) return;
      const dx = spot.x - at.x, dz = spot.z - at.z, span = Math.hypot(dx, dz);
      if (span < row.lunge.minDistance || Math.acos(Math.max(-1, Math.min(1,
        (-dx * Math.sin(player.yaw) - dz * Math.cos(player.yaw)) / span))) > profile.lunge.cone) return;
      const radius = Math.max(row.lunge.minRadius, Math.max(actor.dims.bodyRadius, actor.dims.bodyHalfLen * row.lunge.lengthScale)) * actor.scale;
      const dash = sweptLunge(profile.lunge, move === profile.moves.heavy, dx, dz, radius);
      if (dash !== null) player.dashTo(spot.x, spot.z, dash.stopAt, dash.time);
    };
    const clocks = profiles.map(profile => new SweptMeleeCore<Move>(profile.moves, profile,
      { queue: () => { state.queued = true; seq.queued = current.seq ?? 0; },
        consume: () => { const queued = state.queued; state.queued = false; if (queued) seq.chained = seq.queued; return queued; } },
      { start: (move, dash) => {
        state.struck = false; state.opened = false; state.swings++;
        seq.swing = seq.pressing ? current.seq ?? 0 : seq.chained ?? current.seq ?? 0; seq.chained = null;
        if (seq.swing !== 0) player.swing.seq = seq.swing;
        if (blade !== null) { blade.pose.startSwing(); blade.sweep.reset(); blade.struck.length = 0; }
        if (state.aimed) state.target = aimedBody(profile, move);
        if (dash) lunge(profile, move); ports.alarm();
      }, charge: () => { /* presentation owns the charge tell */ } }));
    const eye = new Vector3(), centre = new Vector3(), point = new Vector3(), forward = new Vector3(), left = new Vector3(), direction = new Vector3(), push = new Vector3();
    // `env` is a row's word for the lead, whose save and rules it fixes; any other player's blows are its own.
    const request: Parameters<SimHost['combat']['hit']>[0] = { source: row.source === 'env' && first ? 'env' : player.health,
      sourceTags: [], target: player.health, amount: 0, point, dir: direction, from: eye, weaponId: '', moveId: '' };
    const contact = { distance: 0, point, head: false };
    /** Land a blow along `forward`, at `point`, or at a rewound contact: the seat has checked the cover it saw, and the body has moved on. */
    const strike = (actor: NativeSweptActor, move: Move, profile: Profile, seen: SeenHit | null): void => {
      left.copy(forward).applyAxisAngle(yAxis, Math.PI / 2);
      sweptStrikeDirection(direction, forward, left, move.sweep, row.contact);
      request.sourceTags = profile.tags; request.target = actor.combatActor(); request.weaponId = profile.weapon; request.moveId = move.id; request.attackSeq = seq.swing;
      request.amount = Math.round(sweptMoveDamage(profile.damage, move, move === profile.moves.heavy, 1));
      const dealt = host.combat.hit(seen === null ? request : { ...request, point: seen.point, seen: seen.seen, headshot: seen.head, sourceTags: [...profile.tags, 'cover.checked'] });
      if (dealt === null) return;
      state.hits++; if (dealt.killed) return;
      sweptStrikePush(push, forward, left, move.sweep, row.contact);
      const running = actor.speed > row.contact.running;
      actor.stagger(push, move.stagger); ports.staggered(actor, Math.max(0, Math.min(move.stagger, 1)), running);
    };
    const newBlade = (): LiveBlade => {
      const pose = new SweptBasePose(), profile = profiles[0]; if (profile === undefined) throw new Error('Swept kit has no slots');
      pose.rest(rig.rest); return { pose, sweep: new BladeSweep(profile.sweep), struck: [], pitch: 0 };
    };
    const pos = new Vector3(), q = new Quaternion(), grip = new Vector3(), tip = new Vector3(), rotation = new Quaternion();
    let met: NativeSweptActor | null = null, past: SeenHit | null = null;
    /** The page's `sweepHit`: this tick's blade, and the sweep from the last one. */
    const sweepBlade = (live: LiveBlade, clock: SweptMeleeCore<Move>, profile: Profile, move: Move | null, active: boolean, t: number): void => {
      live.pose.blend(1 / 60, rig.chargeBlend, clock.chargingHeavy, current.sprint === true, move !== null);
      live.pose.pose(rig, move === null ? null : swingOf(profile, move), clock.swingTime, clock.charge, t, pos, q);
      if (move === null) return;
      sweptBladeDirs(live.pose.basePos, live.pose.baseQ, rig.tipX, rig.tipY, grip, tip);
      eye.copy(player.position); eye.y += row.eye;
      // each tick of a swing reads the view of that tick's command (J50); a held tick reads the present
      const seen = active ? seenBodies(host, current.viewTick) : null;
      if (!active || !live.sweep.have || !(seen === null ? bladeInReach(eye, profile.reach, host.entities.values(), targetRadius) : bladeInReach(eye, profile.reach, seen, targetRadius))) { live.sweep.hold(grip, tip); return; }
      const cy = Math.cos(player.yaw / 2), sy = Math.sin(player.yaw / 2), cp = Math.cos(live.pitch / 2), sp = Math.sin(live.pitch / 2);
      rotation.set(sp * cy, cp * sy, -sp * sy, cp * cy);
      forward.set(-Math.sin(player.yaw) * Math.cos(live.pitch), Math.sin(live.pitch), -Math.cos(player.yaw) * Math.cos(live.pitch));
      live.sweep.sweep(grip, tip, eye, rotation, move.reach ?? profile.reach, {
        raycast: (origin, dir, reach) => {
          if (seen !== null) {
            past = seenRay(seen, origin, dir, reach); met = past?.body ?? null;
            return past === null || met === null ? null : { animal: met, point: past.seen, distance: past.distance, headshot: past.head };
          }
          const hit = rays.ray(bodies(), origin, dir, reach);
          met = hit?.body ?? null;
          return hit === null || met === null ? null : { animal: met, point: hit.point, distance: hit.distance, headshot: hit.head };
        },
        blocked: (origin, at) => !lineOfSight(host.physics, origin, at, row.contact.slack, player.motor.collider),
        strike: hit => {
          if (met === null) return;
          live.struck.push(met.entityId); point.copy(hit.point); strike(met, move, profile, past);
        },
      });
    };
    return {
      loadout, clocks, state,
      step: () => {
        const index = loadout.held(), clock = clocks[index], profile = profiles[index];
        if (clock === undefined || profile === undefined) throw new Error('Missing selected swept melee slot');
        const command = ports.input(player, first), target = command.attack; current = command;
        if (command.swing === true || (command.pitch ?? null) !== null) { blade ??= newBlade(); blade.pitch = command.pitch ?? blade.pitch; }
        if (command.heavy) { state.target = command.heavyTarget; state.aimed = command.swing === true; }
        seq.pressing = true;
        if (target !== null) {
          const idle = clock.move === null, swings = state.swings, previous = state.target, aimed = state.aimed;
          state.target = target; state.aimed = false; clock.tryFire(); if (idle && state.swings === swings) { state.target = previous; state.aimed = aimed; }
        } else if (command.swing === true && !command.heavy) {
          const idle = clock.move === null, swings = state.swings, aimed = state.aimed;
          state.aimed = true; clock.tryFire(); if (idle && state.swings === swings) state.aimed = aimed;
        }
        seq.pressing = false;
        const dt = 1 / 60, t = host.state.tick * dt, { move, active } = clock.step(dt, t, profile.swingScale, command.heavy);
        if (move !== null || showing) { showing = move !== null; player.swing.t = move === null ? null : clock.swingTime; }
        if (move !== null && active && !state.opened) { state.opened = true; state.windows++; }
        if (blade !== null) { sweepBlade(blade, clock, profile, move, active, t); return; }
        if (move === null || !active || state.struck || state.target === null) return;
        const actor = host.entities.get(state.target); if (actor === undefined || !actor.alive) return;
        eye.copy(player.position); eye.y += row.eye;
        queries.closest(actor, eye, Infinity, contact);
        if (contact.distance > (move.reach ?? profile.reach) || !lineOfSight(host.physics, eye, point, row.contact.slack, player.motor.collider)) return;
        state.struck = true;
        centre.copy(actor.position); centre.y += actor.dims.bodyY * actor.scale;
        forward.subVectors(centre, eye); if (forward.lengthSq() < 1e-12) forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)); forward.normalize();
        strike(actor, move, profile, null);
      },
      snapshot: (): SimValue => JSON.stringify({ held: loadout.held(), ...state, aimed: state.aimed ? true : undefined, clocks: clocks.map(clock => clock.snapshot()),
        ...(seq.swing === 0 ? {} : { seq: seq.swing }), ...(seq.queued === 0 ? {} : { queuedSeq: seq.queued }),
        ...(blade === null ? {} : { blade: { pose: blade.pose.snapshot(), grip: blade.sweep.grip.toArray(), tip: blade.sweep.tip.toArray(), have: blade.sweep.have, struck: blade.struck, pitch: blade.pitch } }) }),
      restore: (value: unknown) => {
        if (typeof value !== 'string') throw new Error('Invalid swept melee continuation');
        const parsed = v.parse(v.union([
          v.strictObject({ held: v.pipe(count, v.maxValue(profiles.length - 1)), queued: v.boolean(), struck: v.boolean(), target: v.nullable(v.string()), aimed: v.optional(v.boolean(), false),
            opened: v.optional(v.boolean(), false), windows: v.optional(count, 0), swings: count, hits: count, clocks: v.pipe(v.array(clockSaved), v.length(clocks.length)),
            seq: v.optional(count, 0), queuedSeq: v.optional(count, 0), blade: v.optional(bladeSaved) }),
          v.strictObject({ queued: v.boolean(), struck: v.boolean(), swings: count, hits: count, clock: clockSaved }),
        ]), JSON.parse(value));
        if ('clock' in parsed && clocks.length !== 1) throw new Error('Single-clock continuation requires one swept slot');
        const saved = 'clock' in parsed ? { held: 0, target: null, aimed: false, opened: parsed.struck, windows: parsed.hits,
          queued: parsed.queued, struck: false, swings: parsed.swings, hits: 0, clocks: [parsed.clock], seq: 0, queuedSeq: 0, blade: undefined } : parsed;
        loadout.restore({ held: saved.held, swap: null }); Object.assign(state, { queued: saved.queued, struck: saved.struck, opened: saved.opened,
          windows: saved.windows, target: saved.target, aimed: saved.aimed, swings: saved.swings, hits: saved.hits });
        seq.swing = saved.seq; seq.queued = saved.queuedSeq;
        for (const [index, savedClock] of saved.clocks.entries()) { const restoredClock = clocks[index]; if (restoredClock === undefined) throw new Error('Missing saved swept clock'); restoredClock.restore(savedClock); }
        if (saved.blade === undefined) { blade = null; return; }
        const live = newBlade(), { pose, grip: g, tip: t, have, struck, pitch } = saved.blade;
        live.pose.restore(pose); live.sweep.grip.fromArray(g); live.sweep.tip.fromArray(t); live.sweep.have = have; live.pitch = pitch;
        live.struck.push(...struck); live.sweep.struckN = struck.length;
        struck.forEach((id, at) => { live.sweep.struck[at] = host.entities.get(id) ?? null; });
        blade = live;
      },
    };
  });
  host.onStep(row.step, seats.step, seats.adapter, 'afterBodies');
  const { lead } = seats;
  const equip = (seat: typeof lead, index: number): void => {
    if (!slots.includes(index)) throw new Error('Invalid swept melee slot');
    if (index === seat.loadout.held()) return;
    seat.clocks[seat.loadout.held()]?.stop(); seat.state.queued = false; seat.state.target = null; seat.loadout.select(index);
  };
  return { held: lead.loadout.held,
    equip: index => { equip(lead, index); }, equipFor: (player, index) => { equip(seats.of(player), index); },
    swings: () => lead.state.swings, hits: () => lead.state.hits };
}
