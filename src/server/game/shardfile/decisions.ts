import type { DecisionPublication } from '@wildshard/format/decisionPublication';
import { nativeRuntimeActorIds } from '@wildshard/format/nativeRuntimePlan';
import * as v from 'valibot';
import { decisionScriptContract, actorDecisionRows, parseDecisionScripts, type DecisionScriptRow } from '@wildshard/format/decisionScripts';
import { buildDecisionRegistries, decisionBindingMap, decisionSpawnGroups, DECISION_PLAYER_HANDLE, type DecisionRegistries } from '@wildshard/format/decisionBindings';
import { parseActorMoves, actorMoveRules, type ActorMove } from '@wildshard/format/actorMoves';
import { readCreatureStrikes } from '@wildshard/format/creatures';
import { parseWorldTargets, worldTargetSpots } from '@wildshard/format/worldTargets';
import { SCRIPT_V1_COMMANDS, SCRIPT_V1_READS, SCRIPT_V1_LISTS, type ScriptV1Event, type ScriptV1Command, type ScriptV1ReadName, type ScriptV1ListName } from '@wildshard/format/scriptAbiV1';
import type { DeclaredBodyOps } from '../quest/bodyOps';
import { admitScriptContract } from '@wildshard/format/scriptContract';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { DecisionHost, simDecisionRow, type DecisionWorld, type DecisionContext, type DecisionSnapshot, type DecisionScript } from '@wildshard/engine/script/decision';
import { ActorMoveRunner } from '@wildshard/engine/ai/moves';
import { canReach } from '@wildshard/engine/ai/reach';
import type { PhaseEncounter } from '@wildshard/engine/ai/phases';
import type { SimHost, SimValue, SimStateAdapter } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { StrikeRunner, StrikeSpec, StrikePhase } from '@wildshard/engine/ai/strikes';
import type { Navmesh } from '@wildshard/engine/physics/navmesh';
import type { DeclaredQuests, QuestDataPorts } from '../../../shared/game/quest/declared';
import type { MoverRuntime } from '../plugin/mover';
import { simStrikes } from '../plugin/brain';
import type { ShardScriptPorts } from './scripts';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

interface Motion { move: number; target: number; runner: ActorMoveRunner; binding: number }
interface Strike { strike: number; target: number; binding: number; hit: boolean }
/** Actual game-owned authorities lent to a decision binding. The default SimHost implements this directly.
 * A retained-body adapter lends the existing bodies, strike runners and fixed-step registrations; it must not
 * spawn or step another body, or advance another clock. This is an internal game port, never a shard callback API.
 */
export interface DecisionRuntime extends Pick<SimHost, 'scope' | 'events' | 'physics' | 'groundHeightAt'
  | 'registerStrikeCatalogue' | 'startDeclaredStrike'> {
  readonly flags: Pick<SimHost['flags'], 'has' | 'set' | 'onChange'>;
  readonly player: Pick<PlayerSim, 'id' | 'position' | 'yaw' | 'health' | 'motor'>;
  readonly state: Pick<SimHost['state'], 'tick'>;
  readonly slots: Pick<SimHost['slots'], 'ledgerDedupe'>;
  readonly entities: ReadonlyMap<string, AnimalSim>;
  readonly strikes: ReadonlyMap<string, StrikeRunner>;
  /** Explicit controller handover for already-live runtime.spawns, admitted against the same product ids.
   * Public numeric fields for these actors are their existing AnimalSim.mem entries, named by state.shared.
   */
  readonly borrowedActors?: ReadonlySet<string>;
  /** Existing encounter state of borrowed bodies, read without creating an encounter. */
  readonly borrowedControls?: ReadonlyMap<string, { readonly fighting: boolean; readonly phase: number; readonly calm?: boolean; readonly leanField?: string }>;
  onStep: (id: string, run: () => void, adapter?: SimStateAdapter, phase?: 'beforeBodies' | 'afterBodies') => () => void;
  /** TE-ENG1: the scene lane's public shared fields. `field` on target 0 writes one, so a decision (a boss's windup,
   *  its open core) drives the panels and colliders that read it. Absent without a scene lane: the command refuses. */
  readonly scene?: { readonly write: (field: number, value: number) => void };
}
/** The player a host's scripts deal with: the one its body turned to. Its id stays the script's one player handle. */
export function focusPlayer(host: SimHost): DecisionRuntime['player'] {
  const { id } = host.focusedPlayer;
  return { id, position: host.playerFocus, get yaw() { return host.focusedPlayer.yaw; }, get health() { return host.focusedPlayer.health; }, get motor() { return host.focusedPlayer.motor; } };
}
/** A host's decision runtime: its scripts deal with the player nearest the body that runs them. */
export function decisionRuntime(host: SimHost, scene?: DecisionRuntime['scene']): DecisionRuntime {
  return { ...(scene === undefined ? {} : { scene }), scope: host.scope, events: host.events, flags: host.flags, get physics() { return host.physics; }, groundHeightAt: (x, z) => host.groundHeightAt(x, z), player: focusPlayer(host),
    state: host.state, slots: host.slots, entities: host.entities, strikes: host.strikes,
    registerStrikeCatalogue: (id, specs) => { host.registerStrikeCatalogue(id, specs); }, startDeclaredStrike: (source, target, strike) => host.startDeclaredStrike(source, target, strike),
    onStep: (id, run, adapter, phase) => host.onStep(id, run, adapter, phase) };
}
/** Existing encounter authority; a retained encounter can lend its real BossBrain without a replacement encounter. */
export type DecisionEncounter = Pick<PhaseEncounter, 'boss' | 'retry' | 'validateDecision' | 'applyDecision'>;
/** Live read-only presentation of the actual strike runner, never a second contact clock. */
export interface DecisionStrikeObservation {
  readonly current: Readonly<Pick<StrikeSpec, 'id' | 'range' | 'windup' | 'active' | 'recover' | 'cooldown'>> | null;
  readonly state: StrikePhase;
  readonly windup: number; readonly aim: number;
}
const finite = v.pipe(v.number(), v.finite());
const natural = v.pipe(finite, v.integer(), v.minValue(0));
const pointFields = v.array(v.tuple([natural, natural, finite]));
const continuation = v.strictObject({ contract: v.string(), decision: v.custom<DecisionSnapshot>(value => typeof value === 'object' && value !== null),
  enabled: v.array(v.tuple([natural, v.boolean()])), fields: pointFields, channels: v.array(v.tuple([natural, finite])),
  playerFlags: v.array(natural), zones: v.array(v.string()), phases: v.array(v.tuple([v.string(), natural])),
  moves: v.array(v.strictObject({ actor: natural, move: natural, target: natural, binding: natural, state: v.unknown() })),
  strikes: v.array(v.strictObject({ actor: natural, strike: natural, target: natural, binding: natural, hit: v.boolean() })),
});
function requireValue<T>(value: T | undefined, reason: string): T { if (value === undefined) throw new Error(`Decision world: ${reason}`); return value; }
function inverse(registry: ReadonlyMap<string, number> | undefined): ReadonlyMap<number, string> { return new Map([...registry ?? []].map(([name, id]) => [id, name])); }
function readName(name: string): name is ScriptV1ReadName { return Object.hasOwn(SCRIPT_V1_READS, name); }
function listName(name: string): name is ScriptV1ListName { return Object.hasOwn(SCRIPT_V1_LISTS, name); }

/** One renderer-free v1 decision owner over the existing simulation, move and strike mechanics.
 * Only verified platform section payloads reach this installer. No shard callbacks or author module imports.
 */
export class ShardDecisions {
  readonly host: DecisionHost;
  readonly registries: DecisionRegistries;
  private readonly sim: DecisionRuntime;
  private readonly source: Shardfile;
  private readonly rows: readonly DecisionScriptRow[];
  private readonly spawnGroups: ReadonlyMap<string, readonly string[]>;
  private readonly moves: readonly ActorMove[];
  private readonly spots: ReturnType<typeof worldTargetSpots>;
  private readonly actors: ReadonlyMap<number, string>;
  private readonly names: ReadonlyMap<string, number>;
  /** Private actor registry order is fixed at admission; reuse its scalar handles while polling regions. */
  private readonly actorHandles: readonly number[];
  private readonly enabled = new Map<number, boolean>();
  private readonly motions = new Map<number, Motion>();
  private readonly striking = new Map<number, Strike>();
  private readonly strikeViews = new Map<string, DecisionStrikeObservation>();
  private readonly fieldActors = new Set<number>();
  private readonly fields = new Map<number, Map<number, number>>();
  private readonly channels = new Map<number, number>();
  private readonly playerFlags = new Set<number>();
  private readonly zones = new Set<string>();
  // Keys contain only private scalar handles, never a live actor or host.
  // Weak source ownership drops retired trigger rows; a renamed zone refreshes
  // its strings while positions and entry/leave membership remain live.
  private readonly regionKeys = new WeakMap<Shardfile['quests']['triggers'][number], {
    zone: number; actors: readonly { actor: number; key: string }[];
  }>();
  private readonly phases = new Map<string, number>();
  private readonly encounters: ReadonlyMap<string, DecisionEncounter>;
  private readonly quest: DeclaredQuests | undefined;
  private readonly movers: MoverRuntime | undefined;
  private readonly fact: QuestDataPorts['fact'];
  private readonly navigation: Pick<Navmesh, 'closestWalkable' | 'findPath'> | undefined;
  private readonly contract: string;
  private events: DecisionPublication['events'][number][] = [];
  private readonly strikes;
  /** G566: the lent declared body authority (body reads 20..26, the declared floor list, body commands 17..22) */
  private readonly bodies: DeclaredBodyOps | undefined;
  constructor(sim: DecisionRuntime, source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, sections: ReadonlyMap<string, unknown>,
    encounters: ReadonlyMap<string, DecisionEncounter>, quest: DeclaredQuests | undefined, movers?: MoverRuntime, facts?: QuestDataPorts['fact'], restoring = false,
    navigation?: Pick<Navmesh, 'closestWalkable' | 'findPath'>, onDisabled?: ShardScriptPorts['onDisabled'], bodyOps?: DeclaredBodyOps) {
    this.sim = sim; this.bodies = bodyOps; this.source = source; this.encounters = encounters; this.quest = quest; this.movers = movers; this.fact = facts; this.navigation = navigation;
    const declared = parseDecisionScripts(sections.get('sim/scripts') ?? []);
    this.rows = declared.flatMap(actorDecisionRows); this.spawnGroups = decisionSpawnGroups(source, declared);
    this.moves = parseActorMoves(sections.get('actors/moves') ?? []);
    const nativeStrikes = readCreatureStrikes(sections.get('actors/strikes') ?? []);
    const targets = sections.has('world/targets') ? parseWorldTargets(sections.get('world/targets')) : undefined;
    this.spots = targets === undefined ? new Map() : worldTargetSpots(targets);
    const nativePlan = sections.get('sim/runtime-plan');
    const nativeActors = source.runtime === null && nativePlan !== undefined ? nativeRuntimeActorIds(nativePlan) : [];
    const registries = buildDecisionRegistries(source, this.moves, targets, nativeStrikes, declared, nativeActors);
    this.registries = bodyOps === undefined ? registries : { ...registries, bodies: bodyOps.registries.bodies, colliders: bodyOps.registries.colliders };
    this.names = new Map([...this.registries.actors ?? [], [sim.player.id, DECISION_PLAYER_HANDLE] as const]); this.actors = inverse(this.names);
    this.actorHandles = [...this.names.values()];
    this.strikes = new Map(simStrikes(source.rows));
    for (const { weight: _weight, ...row } of nativeStrikes) this.strikes.set(row.id, { ...row, range: row.range ?? Infinity });
    const moveErrors = actorMoveRules(this.moves, { spots: new Set(this.registries.spots?.keys()), fields: new Set(this.registries.fields?.keys()), strikes: new Set(this.strikes.keys()) });
    if (moveErrors.length > 0) throw new Error(moveErrors.join('; '));
    // Display and admission provenance never change the executable continuation.
    const { achievements: _achievements, ...quests } = source.quests;
    this.contract = JSON.stringify({ rows: this.rows.map(decisionScriptContract), moves: this.moves, ...(this.spots.size === 0 ? {} : { spots: [...this.spots] }), actors: [...this.names], state: source.state,
      ...(this.spawnGroups.size === 0 ? {} : { spawnGroups: [...this.spawnGroups] }),
      ...(sim.borrowedActors === undefined ? {} : { borrowed: [...sim.borrowedActors].sort() }),
      strikes: source.rows.strikes, ...(nativeStrikes.length === 0 ? {} : { nativeStrikes }), quests, encounters: source.encounters, ledger: source.ledger, cues: source.audio.cues, channels: source.clientChannels, movers: source.movers });
    const modules = new Map<string, Uint8Array>(), scripts: DecisionScript[] = [], owners = new Set<string>(), bodies = new Set<AnimalSim>();
    const bindings = this.rows.map((row, index) => {
      const map = decisionBindingMap(row, this.registries), actorIds = Object.values(map.ids.actors ?? {});
      for (const handle of actorIds) {
        const name = requireValue(this.actors.get(handle), 'binding actor');
        const spawn = source.creatures.spawns.find(value => value.id === name);
        const borrowed = sim.borrowedActors?.has(name) === true;
        const runtime = source.runtime?.spawns;
        if (owners.has(name) || (borrowed ? spawn !== undefined || !nativeActors.includes(name) && ![...runtime?.homes ?? [], ...runtime?.bosses ?? [], ...runtime?.actors ?? []].some(value => value.id === name)
          : spawn?.brain !== null)) throw new Error('Decision actor has two controllers');
        const body = requireValue(sim.entities.get(name), 'absent actor');
        if (bodies.has(body)) throw new Error('Decision body has two controllers');
        bodies.add(body);
        owners.add(name); this.fieldActors.add(handle); sim.registerStrikeCatalogue(name, [...this.strikes.values()]);
      }
      if (row.commands.some(name => ['spawn', 'despawn', 'impulse', 'weather'].includes(name))) throw new Error('Decision mechanic has no admitted platform row owner');
      if ((Object.keys(row.bodies ?? {}).length > 0 || Object.keys(row.colliders ?? {}).length > 0) && bodyOps === undefined) throw new Error('Decision body requires its body authority');
      if (row.commands.some(name => name === 'grant' || name === 'reward') && facts === undefined) throw new Error('Decision grant requires the authoritative ledger fact port');
      const binding = row.binding;
      const encounter = 'encounter' in binding ? requireValue(source.encounters.find(value => value.id === binding.encounter), 'encounter binding') : undefined;
      if ('quest' in binding && !quest?.quests.some(value => value.def.id === binding.quest)) throw new Error('Decision quest binding missing');
      if ('zone' in binding && !this.registries.zones?.has(binding.zone)) throw new Error('Decision zone binding missing');
      const self = encounter === undefined ? ('spawnGroup' in binding ? actorIds[0] ?? 0 : 0) : requireValue(this.names.get(encounter.entity), 'encounter actor');
      if (self > 0 && !actorIds.includes(self)) throw new Error('Decision encounter does not own its actor');
      const bytes = requireValue(assets.get(row.module.slice('blobs/wasm/'.length, -'.wasm'.length)), 'module bytes');
      admitScriptContract(bytes, { abi: 1, pages: row.pages }); modules.set(row.module, bytes);
      scripts.push({ ...simDecisionRow(row), state: [...row.state], ids: map.ids, reads: row.reads.filter(readName), lists: row.reads.filter(listName) });
      return { id: index + 1, script: row.id, self, actors: actorIds, instance: 0 };
    });
    const world: DecisionWorld = { player: DECISION_PLAYER_HANDLE, read: (op, a, b, context) => this.read(op, a, b, context), list: (op, a, b, out) => this.list(op, a, b, out),
      prepare: (commands, context) => this.prepare(commands, context), failed: (mode, context, reason) => {
        onDisabled?.({ module: context.script.module, entity: `binding:${context.binding.id}`, reason, failures: 3 });
        if (mode === 'hold') return;
        for (const actor of context.binding.actors) this.stop(actor, true);
        const binding = this.rows.find(row => row.id === context.script.id)?.binding;
        if (mode === 'reset' && binding !== undefined && 'encounter' in binding) this.encounters.get(binding.encounter)?.retry();
      } };
    this.host = new DecisionHost({ scripts, bindings, modules, seed: [source.identity.seed >>> 0, 0], world });
    for (const binding of bindings) { this.enabled.set(binding.id, false); this.host.setEnabled(binding.id, false); }
    for (const row of source.state.shared.filter(field => field.type !== 'string' && field.privacy === 'public')) for (const actor of this.fieldActors) {
      const body = requireValue(this.actor(actor), 'field actor'), borrowed = sim.borrowedActors?.has(requireValue(this.actors.get(actor), 'field actor')) === true;
      const value = borrowed ? body.mem[row.name] ?? Number(row.default) : Number(row.default);
      this.validateField(row.id, value);
      const values = this.fields.get(actor) ?? new Map<number, number>(); values.set(row.id, value); this.fields.set(actor, values);
      if (borrowed) body.mem[row.name] = value;
    }
    sim.scope.onDispose(sim.flags.onChange((name, on) => { const flag = this.registries.flags?.get(name); if (flag !== undefined) this.publish([12, flag, Number(on), 0, 0, 0]); }));
    sim.events.on('damage.dealt', ({ req, dealt }) => {
      const actor = this.combatHandle(req.target.id); if (actor === undefined) return;
      const by = req.source === 'env' ? 0 : this.combatHandle(req.source.id) ?? 0;
      this.publish([7, actor, by, dealt, this.read(5, actor, 0), 0]);
      if (by > 0) { const strike = this.striking.get(by); if (strike !== undefined) strike.hit = true; }
    }, sim.scope);
    sim.events.on('actor.died', ({ actor, req }) => { const handle = this.combatHandle(actor.id); if (handle !== undefined) this.publish([9, handle, req.source === 'env' ? 0 : this.combatHandle(req.source.id) ?? 0, 0, 0, 0]); }, sim.scope);
    sim.onStep('decision.declared', () => { this.events = []; this.lifecycle(); this.host.step(sim.state.tick); this.stepMoves(); }, {
      snapshot: () => this.snapshot(), restore: value => this.restore(value),
    });
    sim.onStep('decision.observations', () => this.observe(), undefined, 'afterBodies');
    if (!restoring) this.lifecycle();
  }
  private actor(handle: number) { const name = requireValue(this.actors.get(handle), 'unknown actor'); return name === this.sim.player.id ? undefined : requireValue(this.sim.entities.get(name), 'absent actor'); }
  private combatHandle(id: string): number | undefined {
    for (const [handle, name] of this.actors) if (this.sim.borrowedActors?.has(name) === true && this.sim.entities.get(name)?.combatActor().id === id) return handle;
    // A retained-body binding shares the world's events but lends only its own body.
    // A catalogue identity alone is not authority to sample another binding's actor.
    return id === this.sim.player.id || this.sim.entities.has(id) ? this.names.get(id) : undefined;
  }
  private position(handle: number) { return handle === DECISION_PLAYER_HANDLE ? this.sim.player.position : requireValue(this.actor(handle), 'actor position').position; }
  private name(kind: keyof DecisionRegistries, id: number): string { return requireValue(inverse(this.registries[kind]).get(id), `undeclared ${kind}`); }
  private inside(zone: string, actor: number): boolean {
    const rows = this.source.quests.triggers, count = rows.length;
    let row: Shardfile['quests']['triggers'][number] | undefined;
    for (let index = 0; index < count; index++) {
      const candidate = requireValue(rows[index], 'decision zone row');
      if (candidate.kind === 'region' && candidate.id === zone) { row = candidate; break; }
    }
    if (row?.kind !== 'region') throw new Error('Missing decision zone');
    const point = this.position(actor); return Math.hypot(point.x - row.x, point.z - row.z) <= row.radius;
  }
  private read(op: number, a: number, b: number, _context?: DecisionContext): number {
    if (op >= SCRIPT_V1_READS.bodyX && op <= SCRIPT_V1_READS.playerIntent) return requireValue(this.bodies, 'body authority').read(op, a, b);
    if (op === 10) return Number(this.sim.flags.has(this.name('flags', a)));
    if (op === 17) { if (a !== DECISION_PLAYER_HANDLE) throw new Error('Decision player kind'); this.name('flags', b); return Number(this.playerFlags.has(b)); }
    if (op === 14) return Number(this.inside(this.name('zones', a), DECISION_PLAYER_HANDLE));
    if (op === 18) {
      const name = this.name('spawns', a), members = this.spawnGroups.get(name) ?? [name];
      return members.reduce((count, id) => count + Number(this.sim.entities.get(id)?.alive === true), 0);
    }
    if (op === 9) {
      this.position(a); const binding = this.rows.find(row => row.id === _context?.script.id)?.binding;
      if (_context !== undefined && this.sim.borrowedControls?.get(_context.script.id)?.calm === true) return 0;
      if (binding !== undefined && 'encounter' in binding) {
        const arena = requireValue(this.source.encounters.find(row => row.id === binding.encounter), 'encounter').arena;
        const player = this.sim.player.position;
        if (Math.hypot(player.x - arena.at[0], player.y - arena.at[1], player.z - arena.at[2]) > arena.radius) return 0;
      }
      return this.sim.player.health.alive ? DECISION_PLAYER_HANDLE : 0;
    }
    if (op === 8 || op === 19) { const from = this.position(a), to = this.position(b); return op === 8 ? Math.hypot(to.x - from.x, to.z - from.z) : Math.atan2(to.x - from.x, to.z - from.z); }
    if (op === 13) return Number(this.inside(this.name('zones', b), a));
    const actor = this.actor(a), point = this.position(a);
    if (op === 1) return point.x; if (op === 2) return point.y; if (op === 3) return point.z;
    if (op === 4) return actor?.yaw ?? this.sim.player.yaw;
    if (op === 5) return actor === undefined ? this.sim.player.health.attributes.health / this.sim.player.health.attributes.maxHealth : actor.hp / actor.maxHp;
    if (op === 6) return Number(actor?.alive ?? this.sim.player.health.alive);
    if (op === 7) return this.fieldValue(a, b);
    if (op === 15) return Number(this.motions.has(a));
    if (op === 16) return ['idle', 'windup', 'active', 'recover', 'cooldown'].indexOf(this.sim.strikes.get(requireValue(this.actors.get(a), 'strike actor'))?.state ?? 'idle');
    throw new Error('Decision read has no authoritative mechanic');
  }
  private list(op: number, a: number, b: number, output: Float64Array): number {
    if (op === SCRIPT_V1_LISTS.declaredFloor) return requireValue(this.bodies, 'body authority').list(op, a, b, output);
    if (op === 6) {
      if (b < 0 || b > 10000) throw new Error('Radial query bounds');
      if (output.length < 2) return 0;
      output[0] = Math.sin(a) * b; output[1] = Math.cos(a) * b; return 2;
    }
    if (op === 3 || op === 4) {
      if (Math.abs(a) > 250 || Math.abs(b) > 250) throw new Error('Decision query outside cell');
      const y = this.sim.groundHeightAt(a, b);
      if (op === 3) { if (output.length === 0) return 0; output[0] = y; return 1; }
      const nav = requireValue(this.navigation, 'navigation owner'), point = nav.closestWalkable({ x: a, y, z: b });
      if (point === null || output.length < 3) return 0;
      output.set([point.x, point.y, point.z]); return 3;
    }
    if (op === 5) {
      const nav = requireValue(this.navigation, 'navigation owner'), points = nav.findPath(this.position(a), this.position(b), this.actor(a)?.dims.bodyRadius ?? this.sim.player.motor.opts.radius, [], 128) ?? [];
      const count = Math.min(points.length, Math.floor(output.length / 3), 32);
      for (let i = 0; i < count; i++) { const point = points[i]; if (point !== undefined) output.set([point.x, point.y, point.z], i * 3); }
      return count * 3;
    }
    let handles: number[];
    if (op === 1) handles = [...this.actors.keys()].filter(actor => actor !== DECISION_PLAYER_HANDLE && this.inside(this.name('zones', a), actor));
    else if (op === 2) { if (b < 0) throw new Error('Invalid player radius'); handles = this.sim.player.health.alive && this.position(a).distanceTo(this.sim.player.position) <= b ? [DECISION_PLAYER_HANDLE] : []; }
    else throw new Error('Decision navigation requires an admitted navigation owner');
    handles.sort((left, right) => left - right); const count = Math.min(output.length, handles.length); for (let i = 0; i < count; i++) output[i] = handles[i] ?? 0; return count;
  }
  private owned(actor: number, context: DecisionContext): string {
    if (actor === DECISION_PLAYER_HANDLE || !context.binding.actors.includes(actor)) throw new Error('Decision actor ownership');
    const name = requireValue(this.actors.get(actor), 'missing actor'); requireValue(this.sim.entities.get(name), 'absent actor'); return name;
  }
  private validateField(field: number, value: number): void {
    const row = requireValue(this.source.state.shared.find(entry => entry.id === field && entry.privacy === 'public' && entry.type !== 'string'), 'public field');
    const low = row.min ?? (row.type === 'bool' ? 0 : row.type === 'i32' ? -2147483648 : -Number.MAX_VALUE);
    const high = row.max ?? (row.type === 'bool' ? 1 : row.type === 'i32' ? 2147483647 : Number.MAX_VALUE);
    if (!Number.isFinite(value) || value < low || value > high || (row.type !== 'f64' && !Number.isInteger(value))) throw new Error('Decision field bounds');
  }
  private fieldValue(actor: number, field: number): number {
    const body = this.actor(actor);
    const value = body !== undefined && this.sim.borrowedActors?.has(requireValue(this.actors.get(actor), 'field actor')) === true
      ? body.mem[requireValue(this.source.state.shared.find(row => row.id === field && row.privacy === 'public' && row.type !== 'string'), 'public field').name]
      : this.fields.get(actor)?.get(field);
    const result = requireValue(value, 'unavailable public field'); this.validateField(field, result); return result;
  }
  private writeField(actor: number, field: number, value: number): void {
    this.fields.get(actor)?.set(field, value);
    const body = this.actor(actor);
    if (body !== undefined && this.sim.borrowedActors?.has(requireValue(this.actors.get(actor), 'field actor')) === true)
      body.mem[requireValue(this.source.state.shared.find(row => row.id === field), 'public field').name] = value;
  }
  private moveStrike(actor: number, binding: number, move?: ActorMove) {
    if (move?.kind === 'dive' && move.strike !== undefined) return requireValue(this.strikes.get(move.strike), 'dive move strike');
    if (move?.kind === 'stalk' && move.ready.kind === 'range' && move.ready.strike !== undefined)
      return requireValue(this.strikes.get(move.ready.strike), 'range move strike');
    const active = this.striking.get(actor)?.strike;
    if (active !== undefined) return this.strikes.get(this.name('strikes', active));
    const name = this.actors.get(actor), initial = this.source.creatures.spawns.find(row => row.id === name)?.strike;
    if (initial !== null && initial !== undefined) return this.strikes.get(initial);
    const row = requireValue(this.rows[binding - 1], 'move binding'), names = Object.values(row.strikes);
    return names.length === 1 ? this.strikes.get(names[0] ?? '') : undefined;
  }
  private prepare(commands: readonly ScriptV1Command[], context: DecisionContext) {
    const apply: (() => void)[] = [], bodyCommands: ScriptV1Command[] = [];
    for (const command of commands) if (command[0] >= SCRIPT_V1_COMMANDS['body.spawn'] && command[0] <= SCRIPT_V1_COMMANDS['body.retire']) bodyCommands.push(command);
    // G566: one transaction; declared body commands validate before anything here commits, and apply in order with the rest
    const body = bodyCommands.length === 0 ? null : requireValue(this.bodies, 'body authority').prepare(bodyCommands);
    if (body !== null) apply.push(() => { body.commit(); });
    for (const [op, target, a, b] of commands) {
      if (op === 8 || (op >= SCRIPT_V1_COMMANDS['body.spawn'] && op <= SCRIPT_V1_COMMANDS['body.retire'])) continue; // Timers are the DecisionHost's transaction, not another clock.
      if (op === 4 && target === 0) {
        const scene = requireValue(this.sim.scene, 'scene field owner'); this.validateField(a, b);
        apply.push(() => { scene.write(a, b); }); continue;
      }
      if (op === 1 || op === 2 || op === 3 || op === 4) {
        const name = this.owned(target, context), actor = requireValue(this.sim.entities.get(name), 'actor');
        if (op === 3) { apply.push(() => this.stop(target)); continue; }
        if (op === 4) {
          this.validateField(a, b);
          apply.push(() => { this.writeField(target, a, b); }); continue;
        }
        if (b > 0) this.position(b);
        if (op === 1) {
          const row = requireValue(this.moves.find(value => value.id === this.name('moves', a)), 'move');
          if (('ground' in row && !row.ground && !actor.flying) || ((row.kind === 'stalk' || row.kind === 'dive' || row.kind === 'takeoff' || row.kind === 'ring-run') && b === 0)) throw new Error('Decision move body/target');
          if (row.kind === 'dive' && row.strike !== undefined && (!context.script.commands.includes('strike')
            || !Object.values(context.script.ids.strikes ?? {}).includes(requireValue(this.registries.strikes?.get(row.strike), 'dive strike')))) throw new Error('Dive strike is outside the binding capability');
          if (row.kind === 'stalk' && row.ready.kind === 'range' && this.moveStrike(target, context.binding.id, row) === undefined) throw new Error('Decision range move needs an unambiguous admitted strike');
          if (row.kind === 'burrow' || row.kind === 'surface') {
            const field = requireValue(this.source.state.shared.find(value => value.name === row.field && value.type === 'f64' && value.privacy === 'public'), 'move field');
            this.validateField(field.id, 0); this.validateField(field.id, 1);
          }
          if (![actor.position.x, actor.position.y, actor.position.z, actor.yaw].every(Number.isFinite)) throw new Error('Nonfinite move body');
          // Capture the starting pose on the commit step, not during validation one body step earlier.
          apply.push(() => { const runner = new ActorMoveRunner(row, actor); this.motions.set(target, { move: a, target: b, runner, binding: context.binding.id }); this.events.push({ kind: 'move', actor: target, id: a, target: b }); });
        } else {
          this.name('strikes', a); if (b === 0) throw new Error('Decision strike requires a target');
          apply.push(() => { if (this.sim.startDeclaredStrike(name, requireValue(this.actors.get(b), 'strike target'), this.name('strikes', a))) {
            this.striking.set(target, { strike: a, target: b, binding: context.binding.id, hit: false }); this.events.push({ kind: 'strike', actor: target, id: a, target: b });
          } else this.host.enqueue(context.binding.id, [11, target, a, 0, 0, 0]); });
        }
      } else if (op === 7) {
        const flag = this.name('flags', a); if (b !== 0 && b !== 1) throw new Error('Decision flag bounds');
        if (target !== 0 && (target !== DECISION_PLAYER_HANDLE || !context.observed.has(target))) throw new Error('Decision player flag authority');
        apply.push(() => { if (target === 0) this.sim.flags.set(flag, b === 1); else if (b === 1) this.playerFlags.add(a); else this.playerFlags.delete(a); });
      } else if (op === 9) {
        this.name('signals', a); apply.push(() => { this.publish([13, a, b, context.binding.self, 0, 0]); });
      } else if (op === 10 || op === 11) {
        const fact = this.name(op === 10 ? 'facts' : 'rewards', a), grant = requireValue(this.fact, 'ledger authority');
        if (target !== 0 && (target !== DECISION_PLAYER_HANDLE || !context.observed.has(target))) throw new Error('Decision ledger player authority');
        apply.push(() => { const key = `decision:${context.binding.id}:${target}:${fact}`; if (!this.sim.slots.ledgerDedupe.includes(key)) { this.sim.slots.ledgerDedupe.push(key); grant(fact, this.sim.player.id); } });
      } else if (op === 12) {
        this.name('cues', a); if (target > 0) this.position(target);
        apply.push(() => { this.events.push({ kind: 'cue', actor: target, id: a, target: 0 }); });
      } else if (op === 13) {
        this.name('channels', a); apply.push(() => { this.channels.set(a, b); });
      } else if (op === 15) {
        const binding = requireValue(this.rows.find(row => row.id === context.script.id), 'binding').binding;
        if (!('encounter' in binding)) throw new Error('Decision encounter ownership');
        const encounter = requireValue(this.encounters.get(binding.encounter), 'encounter');
        encounter.validateDecision(a, b); apply.push(() => { encounter.applyDecision(a, b); });
      } else throw new Error('Decision command has no admitted mechanic');
    }
    return { commit: () => { for (const commit of apply) commit(); } };
  }
  private stop(actor: number, reset = false): void {
    this.motions.delete(actor);
    const name = this.actors.get(actor), body = name === undefined ? undefined : this.sim.entities.get(name);
    body?.setMotion(body.yaw, 0);
    const runner = name === undefined ? undefined : this.sim.strikes.get(name);
    if (reset || runner?.state === 'windup') { this.striking.delete(actor); body?.cancelAttack(); runner?.cancel(); }
  }
  private lifecycle(): void {
    for (let index = 0; index < this.rows.length; index++) {
      const row = requireValue(this.rows[index], 'decision row');
      const binding = row.binding;
      const control = this.sim.borrowedControls?.get(row.id);
      const active = control === undefined ? 'shard' in binding || 'spawnGroup' in binding || ('encounter' in binding ? this.encounters.get(binding.encounter)?.boss.state === 'fight'
        : 'quest' in binding ? (this.quest?.quests.some(value => value.def.id === binding.quest && value.isStarted && !value.isComplete) ?? false)
        : this.inside(binding.zone, DECISION_PLAYER_HANDLE)) : control.fighting;
      const id = index + 1;
      if ((this.enabled.get(id) ?? false) === active) continue;
      this.enabled.set(id, active); this.host.setEnabled(id, active);
      if (!active) for (const handle of Object.values(decisionBindingMap(row, this.registries).ids.actors ?? {})) this.stop(handle, true);
      if (active) this.host.enqueue(id, [1, 0, 0, 0, 0, 0]);
      this.host.enqueue(id, [active ? 15 : 16, DECISION_PLAYER_HANDLE, 0, 0, 0, 0]);
      if (!active) this.host.enqueue(id, [18, 0, 0, 0, 0, 0]);
    }
  }
  private stepMoves(): void {
    for (const [handle, motion] of this.motions) {
      const actor = this.actor(handle); if (actor === undefined || !actor.alive) { this.stop(handle, true); continue; }
      const target = motion.target === 0 ? undefined : this.position(motion.target);
      const row = requireValue(this.moves.find(value => value.id === this.name('moves', motion.move)), 'move');
      const strike = this.moveStrike(handle, motion.binding, row);
      const perch = row.kind === 'takeoff' || row.kind === 'perch' ? requireValue(this.spots.get(row.perch), 'move perch') : undefined;
      const field = row.kind === 'burrow' || row.kind === 'surface' ? this.registries.fields?.get(row.field) : undefined;
      const destination = row.kind !== 'relocate' ? undefined : row.point.kind === 'spot'
        ? requireValue(this.spots.get(row.point.spot), 'move location')
        : { x: this.fieldValue(handle, requireValue(this.registries.fields?.get(row.point.x), 'move x field')),
          z: this.fieldValue(handle, requireValue(this.registries.fields?.get(row.point.z), 'move z field')) };
      const controls = row.kind !== 'steer' ? undefined : {
        yaw: this.fieldValue(handle, requireValue(this.registries.fields?.get(row.fields.yaw), 'move yaw field')),
        speed: this.fieldValue(handle, requireValue(this.registries.fields?.get(row.fields.speed), 'move speed field')),
        turn: this.fieldValue(handle, requireValue(this.registries.fields?.get(row.fields.turn), 'move turn field')),
      };
      const result = motion.runner.step({ body: actor, ...(perch === undefined ? {} : { perch }), ...(target === undefined ? {} : { target, reach: canReach(actor, target, this.sim.physics) }), ...(strike === undefined ? {} : { range: strike.range }),
        ...(field === undefined ? {} : { field: this.fieldValue(handle, field) }), ...(destination === undefined ? {} : { destination }), ...(controls === undefined ? {} : { controls }) });
      if (result.placement !== undefined) { const placement = result.placement; actor.place(placement.x, placement.z, placement.yaw, placement.y); }
      if (result.steering !== undefined) { const steer = result.steering; if (steer.ground) actor.setMotion(steer.yaw, steer.speed, steer.turn); else actor.fly(steer.yaw, steer.speed, steer.altitude, steer.turn); }
      const control = this.sim.borrowedControls?.get(requireValue(this.rows[motion.binding - 1], 'move binding').id);
      if (control?.leanField !== undefined) actor.mem[control.leanField] = result.bank ?? 0;
      if (result.field !== undefined) { const id = requireValue(this.registries.fields?.get(result.field.id), 'move field'); this.writeField(handle, id, result.field.value); }
      if (result.strike !== undefined && motion.target > 0) {
        const strikeId = requireValue(this.registries.strikes?.get(result.strike), 'dive strike');
        if (this.sim.startDeclaredStrike(requireValue(this.actors.get(handle), 'move strike actor'), requireValue(this.actors.get(motion.target), 'move strike target'), result.strike))
          this.striking.set(handle, { strike: strikeId, target: motion.target, binding: motion.binding, hit: false });
        else this.host.enqueue(motion.binding, [11, handle, strikeId, 0, 0, 0]);
      }
      if (result.done !== undefined) { actor.setMotion(actor.yaw, 0); this.motions.delete(handle); this.host.enqueue(motion.binding, [10, handle, motion.move, Number(result.done), 0, 0]); }
    }
  }
  // Native map visitors retain insertion/deletion order without allocating
  // entry tuples on every fixed tick. Each owner installs its callbacks once.
  private readonly observeStrike = (strike: Strike, handle: number): void => {
    const runner = this.sim.strikes.get(requireValue(this.actors.get(handle), 'strike actor'));
    if (runner?.busy === true) return;
    this.striking.delete(handle); this.host.enqueue(strike.binding, [11, handle, strike.strike, Number(strike.hit), 0, 0]);
  };
  private readonly observeEncounter = (encounter: DecisionEncounter, id: string): void => {
    const before = this.phases.get(id) ?? 0, phase = encounter.boss.phase;
    this.phases.set(id, phase); if (phase !== before) { const row = requireValue(this.source.encounters.find(value => value.id === id), 'encounter'); this.publish([8, requireValue(this.names.get(row.entity), 'encounter actor'), phase, 0, 0, 0]); }
  };
  private observe(): void {
    this.striking.forEach(this.observeStrike);
    for (const region of this.source.quests.triggers) {
      if (region.kind !== 'region') continue;
      const zone = requireValue(this.registries.zones?.get(region.id), 'zone');
      let keys = this.regionKeys.get(region);
      if (keys === undefined || keys.zone !== zone) {
        keys = { zone, actors: this.actorHandles.map(actor => ({ actor, key: `${zone}:${actor}` })) };
        this.regionKeys.set(region, keys);
      }
      for (const { actor, key } of keys.actors) {
        const inside = this.inside(region.id, actor), before = this.zones.has(key);
        if (before === inside) continue;
        if (inside) this.zones.add(key); else this.zones.delete(key);
        this.publish([inside ? 4 : 5, zone, actor, 0, 0, 0]);
      }
    }
    for (let index = 0; index < this.rows.length; index++) {
      const row = requireValue(this.rows[index], 'decision row');
      const control = this.sim.borrowedControls?.get(row.id);
      if (control === undefined) continue;
      const before = this.phases.get(row.id) ?? 0; this.phases.set(row.id, control.phase);
      if (control.phase !== before) for (const name of Object.values(row.actors))
        this.host.enqueue(index + 1, [8, requireValue(this.names.get(name), 'threshold actor'), control.phase, 0, 0, 0]);
    }
    this.encounters.forEach(this.observeEncounter);
    if (this.movers !== undefined) for (const event of this.movers.drainEndEvents()) { const signal = this.registries.signals?.get(event.mover); if (signal !== undefined) this.publish([13, signal, Number(event.atEnd), 0, 0, 0]); }
  }
  /** Existing combat/interactions feed this queue; events never execute Wasm synchronously. */
  publish(event: ScriptV1Event): void {
    for (const [id, active] of this.enabled) {
      const row = this.rows[id - 1];
      if (row !== undefined && 'spawnGroup' in row.binding && [7, 8, 9].includes(event[0])
        && !Object.values(decisionBindingMap(row, this.registries).ids.actors ?? {}).includes(event[1])) continue;
      if (active) this.host.enqueue(id, event);
    }
  }
  /** A home replacement starts only its own logical stream; pack mates continue unchanged. */
  restartActor(actor: string): void {
    const handle = requireValue(this.names.get(actor), 'replacement actor');
    const index = this.rows.findIndex(row => 'spawnGroup' in row.binding && Object.values(row.actors).includes(actor));
    if (index === -1) throw new Error('Actor has no spawn-group binding');
    this.stop(handle, true); this.host.restart(index + 1); this.enabled.set(index + 1, false);
    for (const field of this.source.state.shared.filter(row => row.privacy === 'public' && row.type !== 'string')) this.writeField(handle, field.id, Number(field.default));
  }
  /** Borrowed views observe the same runner the fixed-step combat owner updates. A view cannot start/cancel a strike. */
  strikeObservation(actor: string): DecisionStrikeObservation {
    const handle = requireValue(this.names.get(actor), 'strike observation actor');
    if (!this.fieldActors.has(handle)) throw new Error('Decision strike observation needs its owned actor');
    let view = this.strikeViews.get(actor);
    if (view === undefined) {
      const runner = (): StrikeRunner => requireValue(this.sim.strikes.get(actor), 'strike observation runner');
      view = { get current() { return runner().spec; }, get state() { return runner().state; }, get aim() { return runner().yaw; },
        get windup() { return runner().through; } };
      this.strikeViews.set(actor, view);
    }
    return view;
  }
  /** Only the native picker may call this after verifying distance and LOS. */
  interact(id: string): boolean {
    const target = requireValue(this.registries.targets?.get(id), 'interaction target'); let routed = false;
    for (const [index, row] of this.rows.entries()) if (row.on.includes('interact') && Object.values(row.targets).includes(id) && this.enabled.get(index + 1) === true) {
      this.host.enqueue(index + 1, [6, target, DECISION_PLAYER_HANDLE, 0, 0, 0]); routed = true;
    }
    return routed;
  }
  publication(): DecisionPublication { return { tick: this.sim.state.tick,
    fields: [...this.fields].flatMap(([actor, rows]) => [...rows.keys()].map(field => ({ actor, field, value: this.fieldValue(actor, field) }))),
    channels: [...this.channels].map(([channel, value]) => ({ channel, value })), events: structuredClone(this.events) }; }
  private savedStrikes(): { actor: number; strike: number; target: number; binding: number; hit: boolean }[] {
    const rows: { actor: number; strike: number; target: number; binding: number; hit: boolean }[] = [];
    for (const [actor, strike] of this.striking) rows.push({ actor, ...strike });
    return rows;
  }
  /** Logical continuation only. Body, encounter and strike snapshots stay with their existing owners. */
  snapshot(): string { return JSON.stringify({ contract: this.contract, decision: this.host.snapshot(), enabled: [...this.enabled],
    fields: [...this.fields].flatMap(([actor, values]) => [...values.keys()].map(field => [actor, field, this.fieldValue(actor, field)])), channels: [...this.channels], playerFlags: [...this.playerFlags], zones: [...this.zones], phases: [...this.phases],
    moves: [...this.motions].map(([actor, motion]) => ({ actor, move: motion.move, target: motion.target, binding: motion.binding, state: motion.runner.snapshot() })),
    strikes: this.savedStrikes() }); }
  /** View-only channel programs may change without invalidating a retained body's logical save.
   * Registry identities and every mechanical declaration remain exact. Guests with channel/signal
   * capabilities, and owners with actual mover authority, retain the complete original contract. */
  private matchesContract(saved: string): boolean {
    if (saved === this.contract) return true;
    if (this.sim.borrowedActors === undefined || this.movers !== undefined || this.rows.some(row =>
      Object.keys(row.channels).length > 0 || Object.keys(row.signals).length > 0
      || row.commands.some(command => command === 'channel' || command === 'signal')
      || row.on.some(event => event === 'channel' || event === 'signal'))) return false;
    const record = v.record(v.string(), v.unknown()), channels = v.optional(v.array(v.object({ id: v.string() })), []);
    const { channels: previousChannels, movers: _previousMovers, ...previous } = v.parse(record, JSON.parse(saved));
    const { channels: currentChannels, movers: _currentMovers, ...current } = v.parse(record, JSON.parse(this.contract));
    const previousIds = v.parse(channels, previousChannels).map(row => row.id), currentIds = v.parse(channels, currentChannels).map(row => row.id);
    return JSON.stringify(previousIds) === JSON.stringify(currentIds) && JSON.stringify(previous) === JSON.stringify(current);
  }
  /** A logical restore resumes the simulation's clock at its saved tick but carries no decision state (it is not
   *  portable progress): the fresh guests continue from that tick, so the next fixed step is consecutive. */
  continueAt(tick: number): void { this.host.restore({ ...this.host.snapshot(), tick }); }
  /** Validate the whole logical record before mutation; loading invokes no Wasm or gameplay edge. */
  restore(input: SimValue): void {
    if (typeof input !== 'string') throw new Error('Invalid decision continuation');
    const saved = v.parse(continuation, JSON.parse(input)); if (!this.matchesContract(saved.contract)) throw new Error('Incompatible decision continuation');
    const fields = new Map<number, Map<number, number>>();
    for (const [actor, field, value] of saved.fields) { this.position(actor); if (!this.fieldActors.has(actor)) throw new Error('Invalid public field owner'); this.validateField(field, value); const values = fields.get(actor) ?? new Map<number, number>(); if (values.has(field)) throw new Error('Duplicate decision field'); values.set(field, value); fields.set(actor, values); }
    const expectedFields = this.source.state.shared.filter(row => row.privacy === 'public' && row.type !== 'string').length;
    if (saved.fields.length !== this.fieldActors.size * expectedFields || [...fields.values()].some(values => values.size !== expectedFields)) throw new Error('Incomplete decision fields');
    if (new Set(saved.enabled.map(([id]) => id)).size !== this.rows.length || saved.enabled.length !== this.rows.length
      || saved.enabled.some(([id, on]) => id < 1 || id > this.rows.length || saved.decision.bindings.find(row => row.id === id)?.enabled !== on)) throw new Error('Decision binding lifetime restore');
    if (new Set(saved.channels.map(([id]) => id)).size !== saved.channels.length || new Set(saved.playerFlags).size !== saved.playerFlags.length) throw new Error('Duplicate decision scalar');
    for (const [id] of saved.channels) this.name('channels', id);
    for (const id of saved.playerFlags) this.name('flags', id);
    if (new Set(saved.zones).size !== saved.zones.length || new Set(saved.phases.map(([id]) => id)).size !== saved.phases.length) throw new Error('Duplicate decision observation');
    const zoneKeys = new Set([...this.registries.zones?.values() ?? []].flatMap(zone => [...this.names.values()].map(actor => `${zone}:${actor}`)));
    if (saved.zones.some(key => !zoneKeys.has(key))) throw new Error('Invalid decision zone observation');
    for (const [id, phase] of saved.phases) {
      const borrowed = this.sim.borrowedControls?.has(id) === true;
      const encounter = this.source.encounters.find(row => row.id === id);
      if (borrowed ? phase > 255 : encounter === undefined || phase >= encounter.phases.length) throw new Error('Invalid decision phase observation');
    }
    const motions = new Map<number, Motion>();
    for (const motion of saved.moves) { const actor = requireValue(this.actor(motion.actor), 'move actor'), row = requireValue(this.moves.find(value => value.id === this.name('moves', motion.move)), 'move');
      const binding = requireValue(this.rows[motion.binding - 1], 'move binding'), ids = decisionBindingMap(binding, this.registries).ids;
      if (!Object.values(ids.actors ?? {}).includes(motion.actor) || !Object.values(ids.moves ?? {}).includes(motion.move) || motions.has(motion.actor)) throw new Error('Invalid decision move ownership');
      if (motion.target !== 0) this.position(motion.target);
      const runner = new ActorMoveRunner(row, actor); runner.restore(motion.state); motions.set(motion.actor, { ...motion, runner }); }
    if (new Set(saved.strikes.map(row => row.actor)).size !== saved.strikes.length) throw new Error('Duplicate decision strike');
    for (const strike of saved.strikes) {
      const binding = requireValue(this.rows[strike.binding - 1], 'strike binding'), ids = decisionBindingMap(binding, this.registries).ids;
      if (!Object.values(ids.actors ?? {}).includes(strike.actor) || !Object.values(ids.strikes ?? {}).includes(strike.strike)) throw new Error('Invalid decision strike ownership');
      this.position(strike.target);
    }
    this.host.restore(saved.decision);
    this.enabled.clear(); for (const [id, on] of saved.enabled) this.enabled.set(id, on);
    this.fields.clear(); for (const [id, values] of fields) this.fields.set(id, values);
    for (const [actor, values] of fields) for (const [field, value] of values) this.writeField(actor, field, value);
    this.channels.clear(); for (const [id, value] of saved.channels) this.channels.set(id, value);
    this.playerFlags.clear(); for (const id of saved.playerFlags) this.playerFlags.add(id);
    this.zones.clear(); for (const zone of saved.zones) this.zones.add(zone);
    this.phases.clear(); for (const [id, phase] of saved.phases) this.phases.set(id, phase);
    this.motions.clear(); for (const [actor, motion] of motions) this.motions.set(actor, motion);
    this.striking.clear(); for (const { actor, ...strike } of saved.strikes) this.striking.set(actor, strike);
  }
}
