/** Player input controller over its caller’s admitted navmesh and native plan.
 * No product, checkpoint or filesystem work runs on import. */
import {Vector3} from 'three';
import * as v from 'valibot';
import type {SimHost} from '../../../src/server/engine/sim';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {HeadlessRuntimePlan} from '../../../src/server/host/headlessRuntime';
import {parseNavmesh,type Navmesh} from '../../../src/shared/engine/physics/navmesh';
import {nativeGroundBossObservation} from '@wildshard/engine/game/boss/native';
import {PINE_ACT,PINE_INTERACT,QUEST_STEP,pineSpots,type PineSpots} from '../../../src/shards/pine-hollow/generators/questPrompts';
import * as LAYOUT from '../../../src/shards/pine-hollow/generators/layout';
import leadJson from '../../../src/shards/pine-hollow/data/questLead.json' with {type:'json'};
import {parseQuestLeadRows} from '../../../src/shards/pine-hollow/generators/sections';
import wardens from '../../../src/shards/pine-hollow/data/wardensHollow.json' with {type:'json'};
import bossRows from '../../../src/shards/pine-hollow/data/bossEncounter.json' with {type:'json'};
import {LEVER_FLAG,LOADOUT_STEP,PINE_WEAPON,WEAPON_COMMAND} from '../../fixtures/weapon-oracle/nativeLoadout';
import {AIM_COMMAND,AIM_RIBS} from '../../fixtures/weapon-oracle/headlessRanged';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const requireValue=<T>(value:T|undefined|null,message:string):T=>{if(value===undefined||value===null)throw new Error(message);return value;};
const LEAD=parseQuestLeadRows(leadJson),EYE=1.68,LEVER_STEP='pine.lever',CROSSBOW_STEP='pine.crossbow';
type Point = readonly [number, number];
interface Spot { readonly x: number; readonly y: number; readonly z: number }
/** Where a tape is: resumable from a checkpoint exactly as the uninterrupted tape continues. */
export interface TapeState { leg: number; waypoint: number; ticks: number; best: number; stall: number }
/**
 * One stretch of the tape. `go` walks through waypoints (fixed, from the walk baseline's legs, or the navmesh's route
 * between two points, computed once from the route's own points, never from where the player happens to stand); `act`
 * presses a prompt once the player's eye is in its reach; `ride` holds still while the zipline carries the player.
 */
type Leg =
  | { kind: 'go'; path: readonly Point[] }
  | { kind: 'act'; value: number; at: Spot; reach: number; done: (host: SimHost) => boolean }
  | { kind: 'ride' }
  | { kind: 'wait'; until: (host: SimHost) => boolean }
  | { kind: 'king' };

/** The walk baseline's legs (scripts/physics-route.json): the porch, the lookout's five flights. */
const PORCH: readonly Point[] = [[0, -190], [-8, -150], [-30, -95], [-12, -52], [-1, -40], [-5.71, -31.7], [-7.99, -35.02], [-9.56, -34.66], [-10.87, -34.18]];
const OFF_PORCH: readonly Point[] = [[-9.56, -34.66], [-7.99, -35.02], [-5.71, -31.7], [0, -10]];
const LOOKOUT_FOOT: Point = [41.23, 211.92];
/** the lookout trail's foot on the den spur (layout.ts LOOKOUT_TRAIL: one graded traverse up the ridge's face to the pad) */
const TRAIL_FOOT: Point = LAYOUT.LOOKOUT_TRAIL[0] ?? [150, 142];
const CLIMB: readonly Point[] = [[38.48, 213.08], [37.3, 213.28], [34.19, 213.79], [34.35, 214.78], [37.81, 214.21], [37.65, 213.22], [34.19, 213.79], [34.35, 214.78],
  [37.81, 214.21], [37.65, 213.22], [34.34, 213.77], [34.19, 212.83], [34.78, 212.73], [34.53, 211.25], [35.53, 211.14]];
/** up the flights and out of the hatch into the cab (the fire finder's flint; the door to the catwalk and the launch is next) */
const CAB = CLIMB.slice(0, 13);
const reverse = (path: readonly Point[]): Point[] => [...path].reverse();
/** the road below the porch, and the stag's first bend on the west road */
const OFF_ROAD: Point = OFF_PORCH[OFF_PORCH.length - 1] ?? [0, -10], STAG_FIRST: Point = [LEAD.path[0]?.[0] ?? 30, LEAD.path[0]?.[1] ?? -2];
/** the host's day clock's night (0 day … 1 night) */
const night = (host: SimHost): number => host.dayClock?.night ?? 0;

/** The navmesh's walkable route between two ground points for the player's capsule (string-pulled corners). */
function navPath(nav: Navmesh, heightAt: (x: number, z: number) => number, from: Point, to: Point): Point[] {
  const out = nav.findPath({ x: from[0], y: heightAt(from[0], from[1]), z: from[1] }, { x: to[0], y: heightAt(to[0], to[1]), z: to[1] }, 0.4);
  if (out === null) throw new Error(`No navmesh route ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  return [...out.slice(1).map((p): Point => [p.x, p.z]), to];
}

function route(spots: PineSpots, nav: Navmesh, heightAt: (x: number, z: number) => number): Leg[] {
  const row = (id: string): Spot => requireValue(spots.rows.find(r => r.id === id)?.prompt, `missing prompt ${id}`);
  const logA = row('dam-log-a'), logB = row('dam-log-b'), glass = row('pond-glass'), flint = row('ridge-flint');
  const { talk, lanterns, zip } = spots;
  const walk = (from: Point, to: Point): Leg => ({ kind: 'go', path: navPath(nav, heightAt, from, to) });
  const act = (value: number, at: Spot, reach: number, flag: string): Extract<Leg, { kind: 'act' }> => ({ kind: 'act', value, at, reach, done: host => host.flags.has(flag) });
  // the stands: a step short of each prompt, on its open side
  const atLogA: Point = [logA.x + 1.2, logA.z - 0.8], atLogB: Point = [logB.x - 1.2, logB.z - 0.8], atGlass: Point = [glass.x + 1.2, glass.z + 0.6];
  const atPond: Point = [lanterns.pond.x + 1.2, lanterns.pond.z - 0.6], atRidge: Point = [lanterns.ridge.x - 1.4, lanterns.ridge.z - 0.8];
  const atDen: Point = [lanterns.den.x - 1.2, lanterns.den.z - 1.2], landing: Point = [zip.landing.x, zip.landing.z];
  return [
    // 1. up the south road to the ranger's cabin and onto its porch; Hale
    { kind: 'go', path: PORCH }, act(PINE_ACT.talk, talk, talk.radius, 'talked:ranger'),
    // the lever-action off its pegs inside the cabin (its pickup selects it)
    act(PINE_ACT.rifle, spots.rifle, spots.rifle.radius, LEVER_FLAG),
    // 2. off the porch and west to the beaver dam: both logs off, the sluice's glass
    { kind: 'go', path: OFF_PORCH }, walk(OFF_PORCH[OFF_PORCH.length - 1] ?? [0, -10], atLogA), act(PINE_ACT.logA, logA, 2.5, 'lever:dam-log-a'),
    walk(atLogA, atLogB), act(PINE_ACT.logB, logB, 2.5, 'lever:dam-log-b'),
    walk(atLogB, atGlass), act(PINE_ACT.glass, glass, 2.5, 'taken:pond-glass'),
    // 3. the pond's lantern
    walk(atGlass, atPond), act(PINE_ACT.pond, lanterns.pond, lanterns.pond.radius, 'lit:pond'),
    // 4. the lookout: up the five flights to the fire finder's flint, down to the ridge lantern
    walk(atPond, TRAIL_FOOT), { kind: 'go', path: [...LAYOUT.LOOKOUT_TRAIL.slice(1, -1), LOOKOUT_FOOT, ...CAB.slice(0, -1)] }, act(PINE_ACT.flint, flint, 2.5, 'taken:ridge-flint'),
    { kind: 'go', path: [[34.3, 213.0], ...reverse(CAB).slice(1), LOOKOUT_FOOT, atRidge] }, act(PINE_ACT.ridge, lanterns.ridge, lanterns.ridge.radius, 'lit:ridge'),
    // 5. up again to the launch; the zipline down to the Hollow
    { kind: 'go', path: [LOOKOUT_FOOT, ...CLIMB] }, act(PINE_ACT.zip, zip.prompt, zip.prompt.radius, 'used:ph-zip'), { kind: 'ride' },
    // 6. east past Old Blackpaw's cave to the den's lantern
    walk(landing, atDen), act(PINE_ACT.den, lanterns.den, lanterns.den.radius, 'lit:den'),
    // 7. finish Hale's watch dialogue. Its completion starts the night clock and immediately consumes wait:night.
    walk(atDen, OFF_ROAD), { kind: 'go', path: reverse(OFF_PORCH).slice(1) }, { kind: 'act', value: PINE_ACT.talk, at: talk, reach: talk.radius,
      done: host => night(host) > 0.5 || v.parse(v.object({ fast: v.nullable(v.unknown()) }), host.adapters.get(QUEST_STEP)?.snapshot()).fast !== null },
    { kind: 'wait', until: host => night(host) > 0.5 },
    // 8. off the porch and down the west road after the Ghost Stag, bend to bend, into the stones
    { kind: 'go', path: OFF_PORCH }, walk(OFF_ROAD, STAG_FIRST), ...LEAD.path.slice(1).map((bend, i) => walk(LEAD.path[i] ?? STAG_FIRST, [bend[0], bend[1]])),
    { kind: 'wait', until: host => host.flags.has('followed:stag') },
    // 9. the Antler King, by weapon play; 10. the dawn
    { kind: 'king' }, { kind: 'wait', until: host => host.flags.has(wardens.QUEST_DONE) },
  ];
}

const ARRIVE = 0.6, LEG_LIMIT = 60 * 90, STALL = 45, SIDESTEP = 90;
const move = (moveX: number, moveZ: number, yaw: number): HeadlessCommand => ({ kind: 'player', moveX, moveZ, yaw });
/**
 * The tape: a closed loop over where the player stands, one tick's commands at a time. A `go` leg steers straight at its
 * next waypoint at full stick; an `act` leg first walks the eye into the prompt's reach, then presses it until its flag
 * holds (one press a tick, as a player's [E]).
 */
export class PineTape {
  private readonly legs: Leg[];
  private leg = 0;
  private waypoint = 0;
  private ticks = 0;
  /** a `go` leg's nearest approach to its waypoint and the ticks since it last closed in (a body in the way: step round it) */
  private best = Number.MAX_VALUE;
  private stall = 0;
  readonly log: { leg: number; kind: string; tick: number; x: number; y: number; z: number }[] = [];
  constructor(legs: Leg[], from?: TapeState) { this.legs = legs; if (from !== undefined) ({ leg: this.leg, waypoint: this.waypoint, ticks: this.ticks, best: this.best, stall: this.stall } = from); }
  get state(): TapeState { return { leg: this.leg, waypoint: this.waypoint, ticks: this.ticks, best: this.best, stall: this.stall }; }
  get walked(): boolean { return this.leg >= this.legs.length; }
  /** the current leg's kind (null: walked) */
  get current(): Leg['kind'] | null { return this.legs[this.leg]?.kind ?? null; }
  next(host: SimHost): HeadlessCommand[] {
    const leg = this.legs[this.leg];
    if (leg === undefined) return [{ kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(host).yaw }];
    // a creature hunting the player (a bear's pursuit, a boar's charge) is shot down with the crossbow before the tape goes on
    if (leg.kind !== 'ride' && leg.kind !== 'king') { const defend = defence(host); if (defend !== null) return defend; }
    this.ticks++;
    if (this.ticks > LEG_LIMIT) throw new Error(`The tape is stuck on leg ${String(this.leg)} (${leg.kind}, waypoint ${String(this.waypoint)}) at ${leadPlayer(host).position.toArray().map(n => n.toFixed(2)).join(', ')} (health ${String(leadPlayer(host).health.attributes.health)}, night ${night(host).toFixed(2)})`);
    const commands = this.play(host, leg);
    if (commands === null) { this.done(host, leg); return this.next(host); }
    return commands;
  }
  private done(host: SimHost, leg: Leg): void {
    const p = leadPlayer(host).position;
    this.log.push({ leg: this.leg, kind: leg.kind, tick: host.state.tick, x: p.x, y: p.y, z: p.z });
    this.leg++; this.waypoint = 0; this.ticks = 0; this.best = Number.MAX_VALUE; this.stall = 0;
  }
  private play(host: SimHost, leg: Leg): HeadlessCommand[] | null {
    const p = leadPlayer(host).position;
    switch (leg.kind) {
      case 'go': {
        const target = leg.path[this.waypoint];
        if (target === undefined) return null;
        const dx = target[0] - p.x, dz = target[1] - p.z, d = Math.hypot(dx, dz);
        if (d < ARRIVE) { this.waypoint++; this.best = Number.MAX_VALUE; this.stall = 0; return this.play(host, leg); }
        if (d < this.best - 0.05) { this.best = d; this.stall = 0; } else this.stall++;
        // held up (a creature's body across the way): a second and a half to the left of the line, then to the right
        if (this.stall > STALL) {
          if (this.stall > STALL + 2 * SIDESTEP) { this.stall = 0; this.best = Number.MAX_VALUE; }
          const side = this.stall > STALL + SIDESTEP ? -1 : 1, sx = dx / d * 0.4 - dz / d * side, sz = dz / d * 0.4 + dx / d * side, sl = Math.hypot(sx, sz);
          return [move(sx / sl, sz / sl, Math.atan2(-dx, -dz))];
        }
        return [move(dx / d, dz / d, Math.atan2(-dx, -dz))];
      }
      case 'act': {
        if (leg.done(host)) return null;
        const eye = new Vector3(p.x, p.y + EYE, p.z), d = eye.distanceTo(new Vector3(leg.at.x, leg.at.y, leg.at.z));
        if (d < leg.reach - 0.2) return [{ kind: 'script', actorId: PINE_INTERACT, value: leg.value }, move(0, 0, leadPlayer(host).yaw)];
        const dx = leg.at.x - p.x, dz = leg.at.z - p.z, h = Math.max(1e-6, Math.hypot(dx, dz));
        return [move(dx / h, dz / h, Math.atan2(-dx, -dz))];
      }
      case 'ride': return host.flags.has('used:ph-zip') ? null : [move(0, 0, leadPlayer(host).yaw)];
      case 'wait': return leg.until(host) ? null : [move(0, 0, leadPlayer(host).yaw)];
      case 'king': return host.flags.has(bossRows.record.defeated) ? null : kingPlay(host);
      default: return null;
    }
  }
}

const LoadoutRow = v.object({ held: v.number() });
const KingRow = v.object({ boss: v.object({ state: v.string(), phase: v.number(), attempts: v.number() }),
  fight: v.object({ king: v.nullable(v.string()), mode: v.string(), open: v.number(), waves: v.array(v.object({ r: v.number(), on: v.boolean(), delay: v.number() })),
    thralls: v.array(v.object({ a: v.string(), mode: v.string() })) }) });
/** The King's encounter and fight as the boss row continues them (what a player sees: his state, his root rings, his thralls). */
export function kingRow(host: SimHost): v.InferOutput<typeof KingRow> {
  const live=nativeGroundBossObservation(host,bossRows.steps.fight);
  if(live!==undefined)return v.parse(KingRow,{boss:live.boss,fight:{king:live.fight.body,mode:live.fight.mode,open:live.fight.open,
    waves:live.fight.rings,thralls:live.fight.adds}});
  return kingSnapshotRow(host);
}
/** Independent full-continuation projection for native observer equivalence. */
export function kingSnapshotRow(host:SimHost):v.InferOutput<typeof KingRow> {
  const saved = host.adapters.get(bossRows.steps.fight)?.snapshot();
  if (typeof saved !== 'string') throw new Error('Missing the King\'s continuation');
  return v.parse(KingRow, (JSON.parse(saved) as { boss: unknown; fight: unknown }));
}
const LeverRow = v.object({ tube: v.number(), chambered: v.boolean(), phase: v.string(), reserve: v.number() });
const lever = (host: SimHost): v.InferOutput<typeof LeverRow> => v.parse(LeverRow, host.adapters.get(LEVER_STEP)?.snapshot());
/** the King's band: out of his antlers' sweep (7.1 m) and short of the stones' soft wall (27.5 m round the clearing) */
const NEAR = 10, FAR = 15, RING = 21, JUMP_AHEAD = 2.4;
/** Aim at the native cage point; the ordinary ray still chooses the first collision surface. */
const RIBS = AIM_RIBS;
/**
 * The King by weapon play, a tick at a time from what the player sees: into the stones; then a band round him (out of his
 * sweep, inside the ring), circling so his lanes miss; a jump over each root ring as it reaches the player; the lever-action
 * fired at him while the action is idle (an empty trigger reloads), the crossbow once its rounds are spent. Thralls are
 * outrun, never shot: the fight's 26 rounds don't cover both, and shooting them lost it on eight of eight circling rates.
 */
function kingPlay(host: SimHost): HeadlessCommand[] {
  const p = leadPlayer(host).position, row = kingRow(host), C = LAYOUT.KINGS_CLEARING;
  const king = row.fight.king === null ? undefined : host.entities.get(row.fight.king);
  const cx = C.x - p.x, cz = C.z - p.z, toCentre = Math.hypot(cx, cz);
  if (king === undefined || row.boss.state !== 'fight') {
    // into the stones (the fog seals at 22 m) and wait out his intro
    if (toCentre > 14) return [move(cx / toCentre, cz / toCentre, Math.atan2(-cx, -cz))];
    const kx = (king?.position.x ?? C.x) - p.x, kz = (king?.position.z ?? C.z) - p.z;
    return [move(0, 0, Math.atan2(-kx, -kz))];
  }
  const kx = king.position.x - p.x, kz = king.position.z - p.z, d = Math.max(1e-6, Math.hypot(kx, kz));
  // radial: hold the band; tangential: circle him; inward when near the soft wall
  const radial = d < NEAR ? -1 : d > FAR ? 1 : 0;
  let mx = (kx / d) * radial + (-kz / d) * 0.9, mz = (kz / d) * radial + (kx / d) * 0.9;
  if (toCentre > RING) { mx += (cx / toCentre) * 1.5; mz += (cz / toCentre) * 1.5; }
  const m = Math.max(1e-6, Math.hypot(mx, mz));
  // a root ring about to reach the player: jump it
  const jump = row.fight.waves.some(w => w.on && w.delay <= 0 && d - w.r > 0 && d - w.r < JUMP_AHEAD);
  const yaw = Math.atan2(-kx, -kz), gun = lever(host);
  const spent = gun.reserve === 0 && gun.tube === 0 && !gun.chambered;
  const commands: HeadlessCommand[] = [];
  const held = v.parse(LoadoutRow, host.adapters.get(LOADOUT_STEP)?.snapshot()).held, want = spent ? PINE_WEAPON.crossbow : PINE_WEAPON.lever;
  if (held !== want) commands.push({ kind: 'script', actorId: WEAPON_COMMAND, value: want });
  // only into his open ribcage (×3; shut ×0.6, the bark ×0.25), aimed at it
  const ready = spent || gun.phase === 'idle';
  // An empty trigger starts the page's reload; waiting for a chambered round would deadlock the tape.
  const fire = ready && (!gun.chambered || row.fight.open > 0.5);
  if (fire) commands.push({ kind: 'script', actorId: AIM_COMMAND, value: RIBS });
  commands.push({ kind: 'player', moveX: mx / m, moveZ: mz / m, yaw, ...(fire ? { attack: { targetId: king.entityId } } : {}), ...(jump && leadPlayer(host).fall.grounded ? { jump: true } : {}) });
  return commands;
}

const HUNTING = new Set(['stalk', 'charge']), DEFEND_R = 18;
const CrossbowRow = v.object({ loaded: v.boolean(), quiver: v.number() });
/** Stand and shoot the nearest hunter within 18 m. Use the first pickup's crossbow while it has ammunition;
 * an owned, supplied rifle takes over when the bow is dry, through the ordinary loadout swap and trigger. */
function defence(host: SimHost): HeadlessCommand[] | null {
  const p = leadPlayer(host).position;
  let near: { id: string; x: number; z: number; d: number } | null = null;
  for (const body of host.entities.values()) {
    if (!body.alive || !HUNTING.has(body.state)) continue;
    const d = Math.hypot(body.position.x - p.x, body.position.z - p.z);
    if (d < DEFEND_R && (near === null || d < near.d)) near = { id: body.entityId, x: body.position.x, z: body.position.z, d };
  }
  if (near === null) return null;
  const yaw = Math.atan2(-(near.x - p.x), -(near.z - p.z)), held = v.parse(LoadoutRow, host.adapters.get(LOADOUT_STEP)?.snapshot()).held;
  const bow = v.parse(CrossbowRow, host.adapters.get(CROSSBOW_STEP)?.snapshot()), gun = lever(host);
  const suppliedRifle = host.flags.has(LEVER_FLAG) && (gun.chambered || gun.tube > 0 || gun.reserve > 0);
  const want = !bow.loaded && bow.quiver === 0 && suppliedRifle ? PINE_WEAPON.lever : PINE_WEAPON.crossbow;
  if (held !== want) return [{ kind: 'script', actorId: WEAPON_COMMAND, value: want }, move(0, 0, yaw)];
  return [{ kind: 'player', moveX: 0, moveZ: 0, yaw, attack: { targetId: near.id } }];
}

/** The tape over Pine's route, from its first leg or where a checkpoint left it. */
export function pineTape(plan: HeadlessRuntimePlan, bytes:Uint8Array, from?: TapeState): PineTape {
  const nav = requireValue(parseNavmesh(bytes.slice().buffer), 'navmesh parse');
  nav.datum = () => 0;
  const heightAt = requireValue(plan.ports?.heightAt, 'height query');
  return new PineTape(route(pineSpots(), nav, heightAt), from);
}
