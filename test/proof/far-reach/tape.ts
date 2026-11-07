import type {SimHost} from '../../../src/server/engine/sim';
import type {AnimalSim} from '../../../src/shared/engine/entities/AnimalSim';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {CROWN,FALLEN_BRIDGE,KEEPER,ROOST,RUIN,STEP,UPDRAFT,VANES,WINCH} from '../../../src/shards/far-reach/generators/layout';
import {KEEPER_AT} from '../../../src/shards/far-reach/generators/quests';
import {FAN_SWING} from '../../../src/shards/far-reach/generators/rows/items';
import {FAN_ACT,FAN_ACTOR,FAN_AIM} from '../../../src/shards/far-reach/generators/rows/nativeMelee';
import {ROOST_IDS,SKY_ACT,SKY_INTERACT} from '../../../src/shards/far-reach/generators/questPrompts';
import {ROC_ID} from '../../../src/shards/far-reach/generators/rows/rocFight';
import FLAGS from '../../../src/shards/far-reach/data/flags.json' with {type:'json'};
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const EYE=1.68;
const requireValue=<T>(value:T|undefined|null,message:string):T=>{if(value===undefined||value===null)throw new Error(message);return value;};

type Point = readonly [number, number];
/** Where a tape is: resumable from a checkpoint exactly as the uninterrupted tape continues. */
export interface TapeState { leg: number; waypoint: number; ticks: number; hold: Point | null }
/**
 * One stretch of the tape. `go` walks (or rides, on the board) through waypoints; `mode` stops and presses HOVER once
 * the player has come to rest; `act` presses a prompt once it is in reach; `gust` faces a vane and GUSTs until it turns;
 * `roost` holds the roost's deck and swings at its rays until they are down; `winch` waits for the raised bridge;
 * `crown` fights the Storm Roc to its fall.
 */
type Leg =
  | { kind: 'go'; path: readonly Point[] }
  | { kind: 'mode'; board: boolean }
  | { kind: 'act'; value: number }
  | { kind: 'gust'; vane: string; yaw: number }
  | { kind: 'roost'; stand: Point }
  | { kind: 'winch' }
  | { kind: 'crown' };

/** The route, in the order a player takes it (the waypoints are the walk / board legs of scripts/physics-route.json). */
const GROVE_BRIDGE: readonly Point[] = [[-6, -1], [-14.1, 1.3], [-22.5, 2.1], [-29.4, 2.7], [-36.4, 3.4], [-44.8, 4.1], [-52, 4]];
const KEEPER_BRIDGE: readonly Point[] = [[-52, 2], [-54.7, -5.9], [-55.4, -17.5], [-56.0, -27.5], [-56.6, -37.5], [-57.3, -49.1], [-57, -58]];
const ROOST_BRIDGE: readonly Point[] = [[8, -2], [15.3, -3.1], [24.3, -4.9], [31.9, -6.4], [39.5, -7.9], [48.5, -9.7], [56, -14]];
const RUIN_BRIDGE: readonly Point[] = [[59, -18], [60.9, -22.2], [61.7, -32.9], [62.5, -42.0], [63.3, -51.1], [64.1, -61.8], [66, -68]];
const WINDMILL_BRIDGE: readonly Point[] = [[0, -14], [0, -30], [0, -48], [-3, -56]];
const reverse = (path: readonly Point[]): Point[] => [...path].reverse();
const vane = (id: string): { x: number; z: number } => requireValue(VANES.find(row => row.id === id), `missing vane ${id}`);
function route(): Leg[] {
  // the updraft ramp's run, from a few metres short of its foot on the windmill isle to the step's middle
  const ux = UPDRAFT.x1 - UPDRAFT.x0, uz = UPDRAFT.z1 - UPDRAFT.z0, ul = Math.hypot(ux, uz), foot: Point = [UPDRAFT.x0 - ux / ul * 4, UPDRAFT.z0 - uz / ul * 4];
  const keeperVane = vane('keeper'), groveVane = vane('grove'), ruinVane = vane('ruin');
  return [
    // 1. the keeper on Sunrest: walk up to him and talk (his notes)
    { kind: 'go', path: [[KEEPER_AT.x + 0.6, KEEPER_AT.z + 1.2]] }, { kind: 'act', value: SKY_ACT.talk },
    // the grove over its rope bridge; its vane
    { kind: 'go', path: [[-3, -2], ...GROVE_BRIDGE, [groveVane.x, groveVane.z + 6]] }, { kind: 'gust', vane: 'grove', yaw: 0 },
    // on the board over the keeper hover bridge to the keeper's isle; its vane, from its south side
    { kind: 'go', path: [[-52, 4]] }, { kind: 'mode', board: true }, { kind: 'go', path: KEEPER_BRIDGE }, { kind: 'mode', board: false },
    { kind: 'go', path: [[keeperVane.x, keeperVane.z - 6]] }, { kind: 'gust', vane: 'keeper', yaw: Math.PI },
    // on the board back over both bridges, Sunrest and the roost hover bridge to the roost; its three rays
    { kind: 'go', path: [[KEEPER.x + 1, KEEPER.z + 2]] }, { kind: 'mode', board: true },
    { kind: 'go', path: [...reverse(KEEPER_BRIDGE).slice(1), ...reverse(GROVE_BRIDGE).slice(1), ...ROOST_BRIDGE] }, { kind: 'mode', board: false },
    { kind: 'roost', stand: [56, -14] },
    // on foot over the ruin rope bridge; its vane; back to the roost
    { kind: 'go', path: [...RUIN_BRIDGE, [ruinVane.x, ruinVane.z + 6]] }, { kind: 'gust', vane: 'ruin', yaw: 0 },
    { kind: 'go', path: [[RUIN.x, RUIN.z + 2], ...reverse(RUIN_BRIDGE).slice(1), [ROOST.x - 4, ROOST.z - 2]] },
    // on the board back to Sunrest, on foot over the windmill rope bridge, on the board up the updraft to the step
    { kind: 'mode', board: true }, { kind: 'go', path: [...reverse(ROOST_BRIDGE).slice(1), [2, -6]] }, { kind: 'mode', board: false },
    { kind: 'go', path: [...WINDMILL_BRIDGE, foot] }, { kind: 'mode', board: true },
    { kind: 'go', path: [[UPDRAFT.x0, UPDRAFT.z0], [UPDRAFT.x1, UPDRAFT.z1], [STEP.x, STEP.z]] }, { kind: 'mode', board: false },
    // the winch (unlocked: the roost is quiet and the vanes turn), the raised bridge, the crown
    { kind: 'go', path: [[WINCH.x, WINCH.z + 2]] }, { kind: 'act', value: SKY_ACT.winch }, { kind: 'winch' },
    { kind: 'go', path: [[FALLEN_BRIDGE.x0, FALLEN_BRIDGE.z0], [FALLEN_BRIDGE.x1, FALLEN_BRIDGE.z1], [CROWN.x, CROWN.z + 6]] },
    { kind: 'crown' },
  ];
}

/** The initial quest and locked winch, reached over the real windmill bridge
 * and board-only updraft before any roost or vane prerequisite is earned. */
function priorityRoute(): Leg[] {
  const dx=UPDRAFT.x1-UPDRAFT.x0,dz=UPDRAFT.z1-UPDRAFT.z0,length=Math.hypot(dx,dz);
  return [
    {kind:'go',path:[[KEEPER_AT.x+.6,KEEPER_AT.z+1.2]]},
    {kind:'act',value:SKY_ACT.talk},{kind:'act',value:SKY_ACT.talk},
    {kind:'go',path:[...WINDMILL_BRIDGE,[UPDRAFT.x0-dx/length*4,UPDRAFT.z0-dz/length*4]]},
    {kind:'mode',board:true},
    {kind:'go',path:[[UPDRAFT.x0,UPDRAFT.z0],[UPDRAFT.x1,UPDRAFT.z1],[STEP.x,STEP.z]]},
    {kind:'mode',board:false},{kind:'go',path:[[WINCH.x,WINCH.z+2]]},
    {kind:'act',value:SKY_ACT.winch},
  ];
}

/** Within the fan's light reach of the player's eye (its arc aims at the body): a creature the player swings at. */
const swingable = (host: SimHost, actor: AnimalSim): boolean => {
  if (!actor.alive) return false;
  const p = leadPlayer(host).position, dy = actor.position.y + actor.dims.bodyY * actor.scale - (p.y + EYE);
  return Math.hypot(actor.position.x - p.x, dy, actor.position.z - p.z) < FAN_SWING.reach + actor.dims.bodyRadius * actor.scale;
};
const facing = (host: SimHost, x: number, z: number): number => Math.atan2(leadPlayer(host).position.x - x, leadPlayer(host).position.z - z);
/** The browser's light swing aims along the camera: the player turns to what it swings at. */
const CROWN_REACH = 17, ARRIVE = 0.8, ARRIVE_BOARD = 1.5, REST = 0.25, CRUISE = 9, STICK = 3;

/**
 * The tape: a closed loop over what the player sees, one tick's commands at a time. On foot it swings the fan at any
 * creature in reach (the Roc's only in its fight); on the board the fan is stowed and it steers. In the Roc's fight it
 * holds the crown under the bird (never past CROWN_REACH from the crown's middle), swinging as it stoops and GUSTing at it
 * at the camera pitch that frames it (the War Fan alone fells it).
 */
export class SkyTape {
  private readonly legs: readonly Leg[];
  private leg = 0;
  private waypoint = 0;
  /** The leg's ticks (a `mode` press waits for rest; a stuck leg fails the tape rather than looping). */
  private ticks = 0;
  /** The last point a `go` leg reached: a `mode` press brakes onto it before stepping off the board. */
  private hold: Point | null = null;
  readonly log: { leg: number; kind: string; tick: number; x: number; y: number; z: number }[] = [];
  /** A tape resumed where a checkpoint left it (its leg, waypoint, leg ticks and held point ride the checkpoint). */
  constructor(from?: TapeState, priority=false) {
    this.legs=priority?priorityRoute():route();
    if (from !== undefined) ({ leg: this.leg, waypoint: this.waypoint, ticks: this.ticks, hold: this.hold } = from);
  }
  get finished():boolean {return this.leg>=this.legs.length;}
  get state(): TapeState { return { leg: this.leg, waypoint: this.waypoint, ticks: this.ticks, hold: this.hold }; }
  /** Past the board's last leg: on foot on the step, the winch next. */
  get atStep(): boolean { return this.leg >= this.legs.findIndex(leg => leg.kind === 'act' && leg.value === SKY_ACT.winch) - 1; }
  next(host: SimHost): HeadlessCommand[] {
    const leg = this.legs[this.leg];
    if (leg === undefined) return [{ kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(host).yaw }];
    this.ticks++;
    if (this.ticks > 60 * 600) throw new Error(`The tape is stuck on leg ${String(this.leg)} (${leg.kind}) at ${leadPlayer(host).position.toArray().map(n => n.toFixed(2)).join(', ')}`);
    const commands = this.play(host, leg);
    if (commands === null) { this.done(host, leg); return this.next(host); }
    return commands;
  }
  get walked(): boolean { return this.leg >= this.legs.length - 1; }
  private done(host: SimHost, leg: Leg): void {
    const p = leadPlayer(host).position;
    this.log.push({ leg: this.leg, kind: leg.kind, tick: host.state.tick, x: p.x, y: p.y, z: p.z });
    this.leg++; this.waypoint = 0; this.ticks = 0;
  }
  /** This leg's commands for the tick, or null once it is complete. */
  private play(host: SimHost, leg: Leg): HeadlessCommand[] | null {
    const p = leadPlayer(host).position, board = leadPlayer(host).board.on;
    switch (leg.kind) {
      case 'go': {
        const target = leg.path[this.waypoint];
        if (target === undefined) return null;
        const dx = target[0] - p.x, dz = target[1] - p.z, d = Math.hypot(dx, dz), last = this.waypoint === leg.path.length - 1;
        if (d < (board ? ARRIVE_BOARD : ARRIVE)) { this.hold = target; this.waypoint++; return this.play(host, leg); }
        if (board) return [this.ride(host, target, last)];
        return [this.walk(host, dx / d, dz / d, Math.atan2(-dx, -dz))];
      }
      case 'mode': {
        if (board === leg.board) return null;
        // a rider brakes onto the leg's last point before stepping off; a walker stands still and steps on
        const bv = leadPlayer(host).velocity, moving = board && Math.hypot(bv.x, bv.z) > REST;
        if (moving && this.hold !== null) return [this.ride(host, this.hold, true)];
        return [{ kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(host).yaw, ...(moving ? {} : { hover: true as const }) }];
      }
      case 'act': {
        if (this.ticks > 1) return null;
        return [{ kind: 'script', actorId: SKY_INTERACT, value: leg.value }, { kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(host).yaw }];
      }
      case 'gust': {
        if (host.flags.has(`far.vane.${leg.vane}`)) return null;
        return [{ kind: 'player', moveX: 0, moveZ: 0, yaw: leg.yaw }, { kind: 'script', actorId: FAN_ACTOR, value: FAN_ACT.gust }];
      }
      case 'roost': {
        if (host.flags.has(FLAGS.roost)) return null;
        const live = ROOST_IDS.flatMap(id => { const a = host.entities.get(id); return a !== undefined && swingable(host, a) ? [a] : []; });
        const dx = leg.stand[0] - p.x, dz = leg.stand[1] - p.z, d = Math.hypot(dx, dz), walk = d > ARRIVE;
        const target = live[0];
        return [{ kind: 'player', moveX: walk ? dx / d : 0, moveZ: walk ? dz / d : 0, yaw: target === undefined ? leadPlayer(host).yaw : facing(host, target.position.x, target.position.z),
          ...(target === undefined ? {} : { attack: { targetId: target.entityId } }) }];
      }
      case 'winch': {
        if (host.flags.has(FLAGS.raised)) return null;
        return [this.walk(host, 0, 0, leadPlayer(host).yaw)];
      }
      case 'crown': {
        if (host.flags.has(FLAGS.roc)) return null;
        const roc = requireValue(host.entities.get(ROC_ID), 'missing Roc');
        const rx = roc.position.x - CROWN.x, rz = roc.position.z - CROWN.z, out = Math.hypot(rx, rz);
        const grounded = roc.position.y < CROWN.y + 3, follow = grounded || roc.speed < 0.5, k = !follow ? 0 : out > CROWN_REACH ? CROWN_REACH / out : 1;
        const gx = CROWN.x + rx * k - p.x, gz = CROWN.z + rz * k - p.z, g = Math.hypot(gx, gz), near = grounded ? 2 : 1;
        const pitch = Math.atan2(roc.position.y - (p.y + EYE), Math.hypot(roc.position.x - p.x, roc.position.z - p.z));
        return [{ kind: 'player', moveX: g > near ? gx / g : 0, moveZ: g > near ? gz / g : 0, yaw: facing(host, roc.position.x, roc.position.z), attack: { targetId: ROC_ID } },
          { kind: 'script', actorId: FAN_AIM, value: pitch }, { kind: 'script', actorId: FAN_ACTOR, value: FAN_ACT.gust }];
      }
      default: return null;
    }
  }
  /**
   * The board's stick toward a point: the board keeps its momentum, so the rider steers its velocity, not its heading,
   * toward CRUISE m/s along the line to the point (slowing into the last one), full stick against any larger error.
   */
  private ride(host: SimHost, to: Point, last: boolean): HeadlessCommand {
    const p = leadPlayer(host).position, bv = leadPlayer(host).velocity, dx = to[0] - p.x, dz = to[1] - p.z, d = Math.max(1e-6, Math.hypot(dx, dz));
    const speed = last ? Math.min(CRUISE, d * 1.2) : CRUISE, ex = (dx / d) * speed - bv.x, ez = (dz / d) * speed - bv.z, e = Math.max(STICK, Math.hypot(ex, ez));
    return { kind: 'player', moveX: ex / e, moveZ: ez / e, yaw: Math.atan2(-dx, -dz) };
  }
  /** A move; on foot it also swings at the nearest creature in reach (never the Roc outside its fight). */
  private walk(host: SimHost, moveX: number, moveZ: number, yaw: number): HeadlessCommand {
    if (leadPlayer(host).board.on) return { kind: 'player', moveX, moveZ, yaw };
    const target = [...host.entities.values()].find(actor => actor.entityId !== ROC_ID && swingable(host, actor));
    return target === undefined ? { kind: 'player', moveX, moveZ, yaw } : { kind: 'player', moveX, moveZ, yaw: facing(host, target.position.x, target.position.z), attack: { targetId: target.entityId } };
  }
}
