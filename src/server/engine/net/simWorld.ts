import type { NetCommand } from '@wildshard/format/netCommand';
import type { AnimalPoseSample } from '../../../shared/engine/entities/AnimalSim';
import type { SimHost } from '../sim';
import { leadPlayer } from '../../../shared/engine/sim/leadPlayer';
import type { AnimalNetView } from '../../../shared/engine/net/animalNet';
import { actRoutes } from '../../../shared/engine/sim/actRoutes';
import { CombatWire, type CombatEvent } from './combatWire';
import { keepHitHistory } from './hitHistory';
import type { LedgerFiling } from './ledgerBook';
import { questBooks, type QuestProgressRead } from '../../../shared/engine/quest/players';
import { encounterRows } from '../../../shared/engine/sim/encounterRows';
import { ANIMAL_CLASS, ENCOUNTER_CLASS, FLAG_CLASS, PLAYER_CLASS, SCRIPT_CLASS, STATE_CLASS } from '../../../shared/engine/net/netSchemas';
import { NET_POSE, shardRows, type FightViewCall } from '../../../shared/engine/sim/shardRows';
import { FLAG_PREFIX, STATE_PREFIX } from '../../../shared/engine/net/shardNet';
import type { NetRefs } from '../../../shared/engine/net/schema';
import type { NetPlayer, NetTickInput, NetVisitor, NetWorld } from './room';
/** Metres from a player a body's pose inputs are worth saying, the smallest move worth a call, and how many values a room recalls. */
const POSE_REACH = 80, POSE_STEP = 1 / 32, POSE_MEMORY = 8192;

const emptyPose = (): AnimalPoseSample => ({ attackT: -1, attackDur: 1, groundY: 0, tiltRollT: 0, stunT: 0, flinch: 0, flinchRoll: 0, flinchPitch: 0, brace: 0, deathSide: 0 });

/** P1-E5.2: a SimHost as a NetWorld. Reads only; the sim classes do not change. */
export class SimNetWorld implements NetWorld {
  readonly player: NetPlayer;
  private readonly host: SimHost;
  private readonly pose: AnimalPoseSample = emptyPose();
  /** What this room last said of each body's pose inputs. */
  private readonly poses = new Map<string, number>();
  private readonly wire: CombatWire;
  private readonly frame: number;
  private readonly filings: (() => readonly LedgerFiling[]) | undefined;
  private readonly turn = { still: new Set<string>(), extra: new Map<string, NetCommand>() };
  /** `frame` names the cell this host's positions are local to; 0 is the highway, and any world that is not on a grid. `filings` reads the tick's grants, which the host's owner holds: the sim keeps none. */
  constructor(host: SimHost, frame = 0, filings?: () => readonly LedgerFiling[]) {
    this.host = host; this.frame = frame; this.filings = filings; this.wire = new CombatWire(host); keepHitHistory(host);
    this.player = this.playerOf(leadPlayer(host).id);
  }
  /** A player, as the client that owns it reads it. */
  playerOf(id: string): NetPlayer {
    const player = this.host.players.get(id);
    if (player === undefined) throw new RangeError(`Unknown net player ${id}`);
    return { id, cls: PLAYER_CLASS, sample: (out: Float64Array, refs: NetRefs) => { PLAYER_CLASS.owner.forEach((column, index) => { out[index] = column.sample(player, refs); }); },
      ride: out => player.rideWords(out) };
  }
  riders(): ReadonlyMap<string, string> {
    const out = new Map<string, string>();
    for (const player of this.host.players.values()) { const mount = player.ridden; if (mount !== null) out.set(player.id, mount); }
    return out;
  }
  commanded(inputs: readonly NetTickInput[]): void {
    const { turn, host } = this;
    turn.still.clear(); turn.extra.clear();
    for (const { player, still, extra } of inputs) {
      if (still) turn.still.add(player);
      if (extra !== null) turn.extra.set(player, extra);
    }
    host.commanded = turn;
  }
  refused(): number { const routes = actRoutes(this.host), { refused } = routes; routes.refused = 0; return refused; }
  tick(): number { return this.host.state.tick; }
  cell(): number { return this.frame; }
  combat(): readonly CombatEvent[] {
    const { calls } = shardRows(this.host), settled = this.wire.drain(), { tick } = this.host.state;
    this.sayPoses(calls);
    return calls.length === 0 ? settled : [...settled, ...calls.splice(0).map(({ name, args }) => ({ kind: 'view' as const, tick, name, args }))];
  }
  /** What a client's pose programs read of a body near a player, as it changes. A brain's memory is the same record, and no client's. */
  private sayPoses(calls: FightViewCall[]): void {
    const { host, poses } = this, { poseInputs } = actRoutes(host);
    if (poseInputs.size === 0) return;
    if (poses.size > POSE_MEMORY) poses.clear();
    for (const [id, sim] of host.entities) {
      let near = false;
      for (const player of host.players.values()) if (Math.hypot(player.position.x - sim.position.x, player.position.z - sim.position.z) < POSE_REACH) { near = true; break; }
      if (!near) continue;
      for (const name of poseInputs) {
        const value = sim.mem[name];
        if (value === undefined) continue;
        const key = `${id}\0${name}`, was = poses.get(key);
        if (was === value || (was !== undefined && Math.abs(value - was) < POSE_STEP && value !== 0 && value !== 1)) continue;
        poses.set(key, value); calls.push({ name: `${NET_POSE}${id}.${name}`, args: [value] });
      }
    }
  }
  ledger(): readonly LedgerFiling[] { return this.filings?.() ?? []; }
  quests(player: string, since: number): QuestProgressRead | null { return questBooks(this.host).progressOf(player, since); }
  owned(player: string, out: Map<string, number>): void { for (const read of shardRows(this.host).owned.values()) read(player, out); }
  visit(visitor: NetVisitor): void {
    const { host, pose } = this, targets = new Map(host.attackTargets());
    for (const player of host.players.values()) if (!host.parked.has(player.id)) visitor.entity(player.id, PLAYER_CLASS, player);
    for (const [id, sim] of host.entities) {
      sim.samplePose(pose);
      const view: AnimalNetView = { sim, pose, target: targets.get(id) ?? null, rideable: actRoutes(this.host).mountable?.(id) === true };
      visitor.entity(id, ANIMAL_CLASS, view);
    }
    for (const [id, read] of encounterRows(host)) visitor.entity(id, ENCOUNTER_CLASS, read());
    const { bodies, state, world } = shardRows(host);
    for (const [id, read] of bodies) visitor.entity(id, SCRIPT_CLASS, read());
    if (state !== null) for (const row of state()) visitor.entity(`${STATE_PREFIX}${row.name}`, STATE_CLASS, row);
    for (const read of world.values()) for (const row of read()) visitor.entity(`${STATE_PREFIX}${row.name}`, STATE_CLASS, row);
    // only the world's: a flag a quest row wrote is its player's alone (J106), and reaches that client as a phase event
    const books = questBooks(host);
    for (const flag of host.flags.all) if (!books.personal(flag)) visitor.entity(`${FLAG_PREFIX}${flag}`, FLAG_CLASS, flag);
  }
}
