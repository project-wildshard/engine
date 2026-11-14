import { answerV2QueryBatch } from '@wildshard/engine/script/queriesV2';
import { resolvePhysicsQueriesV2,type V2QueryWorld } from '@wildshard/engine/physics/queryBatchV2';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { Elites } from '../../../client/game/Elite';
import { readEliteOutputV2,ELITE_OUTPUT_OPERATION,type EliteOutput } from '@wildshard/format/eliteFeature';
import { readV2WorldAction,V2_ACTION_OPS,type V2ActionBinding,type V2WorldAction } from '@wildshard/format/scriptActionsV2';
import { prepareV2WorldActions,type V2WorldActionLoan } from '../../../shared/game/shardfile/worldActionsV2';
import * as v from 'valibot';
import { sayFightView } from '@wildshard/engine/sim/shardRows';
import { spawnCueWord } from '../../../shared/game/shardfile/wirePrompts';
import { OwnedSimBatchV2,type OwnedV2Binding,type OwnedV2Frame } from '@wildshard/engine/script/ownedSimBatchV2';
import { ObservationColumnsV2,type V2ColumnOwners } from '@wildshard/engine/script/observationColumnsV2';
import { layoutV2 } from '@wildshard/format/scriptWireV2';
import { SpawnInputV2Schema } from '@wildshard/format/spawnScriptV2';


import { actorDecisionRows, decisionScriptContract } from '@wildshard/format/decisionScripts';
import { ScriptStrikes, type ScriptStrikeHit } from './scriptStrikes';
import { canReach } from '@wildshard/engine/ai/reach';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { DecisionHost, simDecisionRow, type DecisionContext, type DecisionScript, type DecisionWorld, type DecisionSnapshot,type DecisionExternalCommand } from '@wildshard/engine/script/decision';
import { ActorMoveRunner } from '@wildshard/engine/ai/moves';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { DayCycleClock } from '@wildshard/engine/world/dayCycle';
import { Rng } from '@wildshard/engine/core/rng';
import { DECISION_PLAYER_HANDLE, decisionBindingMap } from '@wildshard/format/decisionBindings';
import { parseSpawnScript, SpawnScriptsSchema, spawnScriptRegistries, type SpawnScriptRows } from '@wildshard/format/spawnScripts';
import { SCRIPT_V1_EVENTS, SCRIPT_V1_READS, SCRIPT_V1_LISTS, type ScriptV1Command, type ScriptV1ReadName, type ScriptV1ListName } from '@wildshard/format/scriptAbiV1';
import { sha256 } from '../../../shared/game/plugin/moduleHash';
import { admitScriptContract } from '@wildshard/format/scriptContract';
import { populationRoster } from './roster';
import { nativePopulationOf } from '../riding/nativePopulation';
import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';

/** Entered concrete service loans only; no shard callback or reflected name resolver. */
export type SpawnV2Owners = Omit<V2ColumnOwners,'self' | 'player' | 'observed' | 't' | 'dt'> & { readonly module?: Uint8Array };
/** Actual native worlds keyed by the original numeric binding id, not an
 * authored resolver. Roster arrays preserve the source owner's live order. */
export interface SpawnQueryLoansV2 { readonly worlds: ReadonlyMap<number,V2QueryWorld> }
/** Internal page-effect transaction forwarded through the ORIGINAL ephemeral
 * effect stream and applied by its existing post-update entered drain. */
export interface PreparedSpawnPageBank { readonly validate: () => void; readonly operations: readonly (() => void)[] }
interface SpawnEffectOwners { readonly elites?: Elites; readonly world?: readonly V2WorldActionLoan[] }

type ControlledBody = AnimalSim & { hidden?: boolean };
const claimedBodies = new WeakMap<AnimalSim, SpawnScript>();
interface Point { readonly x: number; readonly y: number; readonly z: number }
/** Internal body authority. Only built-in native/page adapters construct it; shard-facing installers take rows. */
interface SpawnBodyOwner {
  spawn: (kind: string, x: number, z: number, yaw: number, variant: string) => ControlledBody;
  retire: (actor: AnimalSim) => void;
  actor: (id: string) => ControlledBody | null;
  height: (x: number, z: number) => number;
  available: () => number;
  boot: () => readonly ControlledBody[];
  reach: (body: AnimalSim, target: Point) => boolean;
  show?: (body: AnimalSim, visible: boolean) => void;
  pageActor?: (id: string) => Animal | null;
}
type Effect = { readonly kind: 'cue' | 'retire'; readonly id: number; readonly actor: number; readonly at: Point }
  | { readonly kind: 'hit'; readonly actor: number; readonly hit: ScriptStrikeHit }
  | { readonly kind: 'page-bank'; readonly bank: PreparedSpawnPageBank };
const NO_EFFECTS: readonly Effect[] = Object.freeze([]);
interface Motion { readonly id: number; readonly target: number; readonly runner: ActorMoveRunner }
const finite = v.pipe(v.number(), v.finite());
const natural = v.pipe(finite, v.integer(), v.minValue(0));
const pair = v.tuple([natural, finite]);
const Saved = v.strictObject({ v2Input: v.exactOptional(SpawnInputV2Schema),version: v.literal(2), contract: v.string(), decision: v.custom<DecisionSnapshot>(input => typeof input === 'object' && input !== null),
  actors: v.array(v.tuple([natural, v.string()])), fields: v.array(v.tuple([natural, natural, finite])),
  channels: v.array(pair), force: v.pipe(natural, v.maxValue(8)), elapsed: v.pipe(finite, v.minValue(0), v.maxValue(1 / 60)),
  strikes: v.exactOptional(v.unknown()),
  moves: v.array(v.strictObject({ actor: natural, id: natural, target: natural, state: v.unknown() })),
});
function value<T>(input: T | undefined, reason: string): T { if (input === undefined) throw new Error(`Spawn script: ${reason}`); return input; }

/** V1 commands over existing actor lifetimes. Logical slots never replace native identity allocation or its RNG stream.
 * This internal runner has no shard hooks: native/page installers supply the real built-in body owner. */
export class SpawnScript {
  readonly host: DecisionHost;
  private readonly rows: SpawnScriptRows;
  private readonly registries: ReturnType<typeof spawnScriptRegistries>;
  private readonly sourceFields = new Map<SpawnScriptRows['fields'][number]['source'], number>();
  private readonly observingSlots = new Set<number>();
  private readonly v2: OwnedSimBatchV2 | undefined;
  private readonly v2Columns: ObservationColumnsV2 | undefined;
  private readonly v2Contract: string | undefined;
  private readonly queryWorlds: ReadonlyMap<number,V2QueryWorld> | undefined;
  private readonly v2Bindings: readonly OwnedV2Binding[];
  private readonly handles = new Map<number, ControlledBody>();
  private readonly adoptedBodies = new WeakSet<AnimalSim>();
  private readonly fields = new Map<string, number>();
  /** PF5: each (actor, field)'s key in `fields`, made once: a guest read builds no string */
  private readonly fieldKeys = new Map<number, string>();
  /** PF5: each moving actor's site (static rows), found once instead of per fixed step */
  private readonly motionSites = new Map<number, SpawnScriptRows['sites'][number] | undefined>();
  private readonly channels = new Map<number, number>();
  private readonly motions = new Map<number, Motion>();
  private readonly contract: string;
  private readonly combat: ScriptStrikes;
  private readonly bindings = new Map<number, number>();
  private readonly observations = new Map<string, number>();
  private readonly observedFields: ReadonlySet<string>;
  private readonly columnFields: ReadonlySet<string>;
  private readonly frameFlags: string[] = [];
  private point: Point = { x: 0, y: 0, z: 0 };
  private night = 0;
  private playerYaw = 0;
  private maximum = 0;
  private forced = 0;
  private elapsed = 0;
  private tick = 0;
  private effects: Effect[] = [];
  private readonly flags = new Set<string>();
  private disabledReason: string | null = null;
  private readonly controlState: AnimalSim['state'];
  /** The decision host's final refusal, exposed without a callback into content. */
  get failure(): string | null { return this.disabledReason; }
  private constructor(input: unknown, private readonly bodies: SpawnBodyOwner, private readonly v2Owners?: SpawnV2Owners,private readonly effectOwners?: SpawnEffectOwners,queryLoans?: SpawnQueryLoansV2,private readonly nativeHost?: SimHost,rawModule?: Uint8Array) {
    const rows = parseSpawnScript(input); this.rows = rows;
    this.observedFields = new Set(rows.fields.filter(row => row.source === 'observed').map(row => row.id));
    this.columnFields = new Set(rows.v2?.columns.map(row => row.name));
    this.controlState = v.parse(v.picklist(ANIMAL_STATES), rows.controlState);
    const registries = spawnScriptRegistries(rows); this.registries = registries;
    // Admission owns these catalogues; only their ordinals/authority are
    // retained. Actor bodies, numeric values and guest cadence stay live.
    rows.fields.forEach((row, index) => { if (!this.sourceFields.has(row.source)) this.sourceFields.set(row.source, index + 1); });
    for (const row of rows.slots) if (row.authority === 'observe') this.observingSlots.add(row.handle);
    this.combat = new ScriptStrikes(rows.strikes ?? []);
    // an admitted raw module arrives by one loan: the entered v2 owners' or a native population's (CI12), never both
    if (v2Owners?.module !== undefined && rawModule !== undefined) throw new Error('Two raw spawn module loans');
    const lentModule = v2Owners?.module ?? rawModule;
    const bytes = lentModule ?? Uint8Array.from(atob(rows.bytes), byte => byte.codePointAt(0) ?? 0);
    if (lentModule !== undefined && (rows.bytes !== '' || !(bytes instanceof Uint8Array) || rows.script.module !== `blobs/wasm/${sha256(bytes)}.wasm`)) throw new Error('Invalid raw spawn module');
    admitScriptContract(bytes, { abi: 1, pages: rows.script.pages });
    const { v2: selected,...originalRows } = rows;
    this.contract = JSON.stringify({ ...originalRows, script: decisionScriptContract(rows.script), bytes: undefined });
    this.v2Contract = selected === undefined ? undefined : JSON.stringify({ ...selected,bytes: undefined });
    if (selected !== undefined && v2Owners === undefined) throw new Error('V2 spawn requires entered concrete owners');
    if ((selected !== undefined || v2Owners?.module !== undefined) && (v2Owners?.scope.disposed === true || v2Owners?.scope.disposing === true)) throw new Error('Retired v2 actor scope');
    if (selected?.queries !== undefined && queryLoans === undefined) throw new Error('Missing concrete query world authority');
    if (selected?.queries === undefined && queryLoans !== undefined) throw new Error('Undeclared query world authority');
    if (selected?.effects?.elites === true && (effectOwners?.elites === undefined || bodies.pageActor === undefined)) throw new Error('Missing concrete page effect authority');
    if (selected?.effects?.world !== undefined && effectOwners?.world === undefined) throw new Error('Missing concrete world effect authority');
    this.v2Columns = selected === undefined || v2Owners === undefined ? undefined : new ObservationColumnsV2(selected.columns,v2Owners.scope);
    const scripts: DecisionScript[] = [];
    for (const row of actorDecisionRows(rows.script)) {
      const state: DecisionScript['state'][number][] = [...row.state];
      scripts.push({ ...simDecisionRow(row), ids: decisionBindingMap(row, registries).ids, state,
        reads: row.reads.filter((name): name is ScriptV1ReadName => Object.hasOwn(SCRIPT_V1_READS, name)),
        lists: row.reads.filter((name): name is ScriptV1ListName => Object.hasOwn(SCRIPT_V1_LISTS, name)),
      });
    }
    const bindings = scripts.map((script, index) => {
      const actors = Object.values(script.ids.actors ?? {}), self = 'spawnGroup' in rows.script.binding ? actors[0] ?? 0 : 0;
      this.bindings.set(self, index + 1); return { id: index + 1, script: script.id, self, actors, instance: 0 };
    });
    const world: DecisionWorld = { read: (op, a, b) => this.read(op, a, b), list: (op, a, b, out) => {
      if (op === 6) { if (b < 0 || b > 10000) throw new Error('Radial query bounds'); out[0] = Math.sin(a) * b; out[1] = Math.cos(a) * b; return 2; }
      if (op !== 3) throw new Error('Unsupported population list'); out[0] = bodies.height(a, b); return 1;
    }, prepare: (commands, context) => this.prepare(commands, context),
      ...(selected?.effects === undefined ? {} : { prepareExternal: (commands: readonly DecisionExternalCommand[],context: DecisionContext) => this.prepareExternal(commands,context) }), failed: (_mode, _context, reason) => { this.disabledReason = reason; } };
    if (queryLoans !== undefined) {
      if (queryLoans.worlds.size !== bindings.length || [...queryLoans.worlds.keys()].some(id => !bindings.some(binding => binding.id === id))) throw new Error('Invalid query world binding identities');
      this.queryWorlds = new Map([...queryLoans.worlds].map(([id,loan]) => [id,{ physics: loan.physics,navmesh: loan.navmesh,bodies: loan.bodies,sees: [...loan.sees],as: loan.as,...(loan.rosters === undefined ? {} : { rosters: loan.rosters }) }]));
    }
    this.host = new DecisionHost({ scripts, bindings, modules: new Map([[rows.script.module, bytes]]), seed: [rows.seed >>> 0, 0],
      world, ...(selected === undefined ? {} : { externalDivisor: selected.divisor }),limits: { fuelPerCall: 2000000, fuelPerTick: 8000000 } });
    this.v2Bindings = bindings.map(binding => ({ binding: { ...binding,self: selected?.self === undefined ? binding.self : value(rows.slots.find(slot => slot.id === selected.self), 'v2 self').handle },script: value(scripts.find(script => script.id === binding.script), 'v2 declaration') }));
    if (selected !== undefined) {
      const modern = Uint8Array.from(atob(selected.bytes), byte => byte.codePointAt(0) ?? 0);
      admitScriptContract(modern,{ abi: 2,lane: 'sim',pages: selected.artifact.pages,ioBytes: selected.artifact.ioBytes,compilerRevision: selected.artifact.compilerRevision,admissionRevision: selected.artifact.admissionRevision });
      this.v2 = new OwnedSimBatchV2(modern,{ host: this.host,bindings: this.v2Bindings,layout: layoutV2(selected.io,selected.artifact.pages,new Map(selected.capacities.map(row => [row.kind,row.capacity]))),
        divisor: selected.divisor,fuel: selected.fuel,initFuel: selected.initFuel,seed: [rows.seed >>> 0,0],eventKinds: new Set(rows.script.on.map(name => SCRIPT_V1_EVENTS[name])),externalCommands: selected.effects !== undefined,...(selected.queries === undefined ? {} : { queries: { pending: selected.queries.pending,operations: new Map(selected.queries.operations.map(row => [row.op,row.scalars])) } }) });
    }
    if ('shard' in rows.script.binding) for (const binding of bindings) {
      if (this.v2 === undefined) this.host.enqueue(binding.id,[1,0,0,0,0,0]);
      else if (rows.script.on.includes('start')) this.v2.enqueue(0,binding.id,[1,0,0,0,0,0],this.v2Identities());
    }
  }
  /** Native binding takes existing platform authorities and rows, never per-shard ports. */
  static native(host: SimHost, input: unknown,v2Owners?: SpawnV2Owners,worldActions?: readonly V2WorldActionLoan[],queries?: SpawnQueryLoansV2): SpawnScript {
    if (queries !== undefined && [...queries.worlds.values()].some(world => world.physics !== host.physics)) throw new Error('Foreign native query world');
    const rows = parseSpawnScript(input), roster = populationRoster(host, rows.roster);
    for (const row of rows.species) roster.validateSpawn(row.kind, row.variant);
    return new SpawnScript(rows, { spawn: roster.spawn, retire: actor => {
      const body = roster.actor(actor.entityId); if (body !== actor) throw new Error('Foreign native script actor');
      roster.retire(body);
    }, actor: roster.actor,
      height: (x, z) => host.groundHeightAt(x, z), available: roster.available, boot: () => roster.bodies().filter(row => row.scripted).map(row => row.actor),
      reach: (body, target) => canReach(body, target, host.physics) },v2Owners,worldActions === undefined ? undefined : { world: worldActions },queries,host);
  }
  /** Borrow the installed mounted-world population explicitly. This is not a
   * fallback for a missing roster: the admitted id and every recipe must match
   * that concrete owner before the script allocates its guest or any body. `module`: the admitted raw module for a row whose
   * bytes are blank (its script.module names the module's SHA-256), checked as the entered v2 owners' loan is (CI12). */
  static nativePopulation(host: SimHost, input: unknown, module?: Uint8Array): SpawnScript {
    const rows = parseSpawnScript(input), roster = nativePopulationOf(host);
    if (host.scope.disposed || host.scope.disposing || roster === undefined || roster.host !== host || roster.id !== rows.roster)
      throw new Error('Missing matching native population service');
    for (const row of rows.species) roster.validateSpawn(row.kind, row.variant);
    const actor = (id: string): ControlledBody | null => roster.bodies.find(body => body.entityId === id) ?? null;
    return new SpawnScript(rows, {
      spawn: roster.spawnElite,
      retire: body => {
        if (actor(body.entityId) !== body || host.entities.get(body.entityId) !== body) throw new Error('Foreign native script actor');
        roster.retireElite(body);
      }, actor, height: (x, z) => host.groundHeightAt(x, z), available: roster.available,
      boot: () => roster.bodies.filter(body => body.scripted),
      reach: (body, target) => canReach(body, target, host.physics),
    }, undefined, undefined, undefined, host, module);
  }
  /** Client-only binding to the page's row bodies. Its existing spawn/retire path owns bodies and draws. */
  static page(animals: RowBodiesView, input: unknown, physics?: Physics | null,v2Owners?: SpawnV2Owners,elites?: Elites,worldActions?: readonly V2WorldActionLoan[],queries?: SpawnQueryLoansV2): SpawnScript {
    if (queries !== undefined && (physics === undefined || physics === null || [...queries.worlds.values()].some(world => world.physics !== physics))) throw new Error('Foreign page query world');
    return new SpawnScript(input, { spawn: (kind, x, z, yaw, variant) => animals.spawn(kind, x, z, yaw, variant),
      retire: actor => { const real = animals.animals.find(row => row === actor); if (real === undefined) throw new Error('Foreign page spawn retirement'); animals.retire(real); },
      actor: id => animals.animals.find(row => row.entityId === id) ?? null,
      pageActor: id => animals.animals.find(row => row.entityId === id) ?? null, height: terrainHeight,
      available: () => 16384 - animals.animals.length, boot: () => animals.animals.filter(row => row.scripted),
      reach: (body, target) => physics !== undefined && physics !== null && canReach(body, target, physics),
      show: (body, visible) => { const real = animals.animals.find(row => row === body); if (real !== undefined) real.mesh.visible = visible; },
    },v2Owners,{ ...(elites === undefined ? {} : { elites }),...(worldActions === undefined ? {} : { world: worldActions }) },queries);
  }
  /** One explicit call at the existing post-body slot for the complete actor
   * module set. No scheduler, world registry, saved owner or guest callback is
   * created. Every module and native loan preflights before the resolver runs. */
  static answerQueries(runners: readonly SpawnScript[]): void {
    if (runners.length === 0 || runners.length > 64) throw new Error('Invalid actor query batch size');
    const tick = value(runners[0],'query batch').tick;
    const modules = runners.map(runner => {
      const ring = value(runner.v2?.queryRing,'query ring'),worlds = value(runner.queryWorlds,'query worlds'),scope = value(runner.v2Owners,'query owners').scope;
      if (runner.tick !== tick || scope.disposed || scope.disposing || runner.nativeHost?.scope.disposed || runner.nativeHost?.scope.disposing || runner.nativeHost !== undefined && runner.nativeHost.state.tick !== tick) throw new Error('Retired or mismatched actor query phase');
      return { identity: runner.rows.step,ring,runner,worlds: new Map([...worlds].map(([id,world]) => [String(id),world])) };
    });
    const owners = new Map(modules.map(row => [row.identity,row]));
    const worlds = new Map(modules.map(row => [row.identity,row.worlds]));
    answerV2QueryBatch(modules,tick,requests => {
      // Validate every requested native loan before any physics query. Idle
      // bindings and unrequested rosters never traverse their live actors.
      for (const { module: identity,request } of requests) {
        if (request.op !== 10) continue;
        const owner = value(owners.get(identity),'query module'),world = owner.worlds.get(request.binding);
        const roster = world?.rosters?.get(request.values[4]);
        if (roster === undefined) continue; // H5 returns the original denied status.
        if ((world?.rosters?.size ?? 0) > 256 || roster.length > 256) throw new Error('Query roster capacity');
        for (const actor of roster) if (actor.alive && owner.runner.bodies.actor(actor.entityId) !== actor) throw new Error('Foreign query roster actor');
      }
      return resolvePhysicsQueriesV2(requests,worlds);
    });
  }
  /** Trusted native registration over already constructed actor modules. All
   * query continuations stay in those modules' original snapshot adapters. */
  static installQueries(host: SimHost,runners: readonly SpawnScript[]): () => void {
    if (runners.length === 0 || runners.length > 64 || new Set(runners).size !== runners.length || new Set(runners.map(runner => runner.rows.step)).size !== runners.length
      || runners.some(runner => runner.nativeHost !== host || runner.v2?.queryRing === undefined || runner.tick !== host.state.tick)) throw new Error('Foreign native actor query owner');
    const modules = [...runners];
    return host.onStep('script.v2.queries',() => { SpawnScript.answerQueries(modules); },undefined,'afterBodies');
  }
  private v2Identities(): ReadonlyMap<number,string> {
    const rows = new Map([...this.handles].map(([handle,body]) => [handle,body.entityId]));rows.set(DECISION_PLAYER_HANDLE,`${this.rows.step}:player`);return rows;
  }
  private captureV2(due: ReadonlySet<number>): OwnedV2Frame {
    const owners = value(this.v2Owners,'entered v2 owners'), columns = value(this.v2Columns,'v2 columns');
    if (owners.scope.disposed || owners.scope.disposing) throw new Error('Retired v2 actor scope');
    const player = DECISION_PLAYER_HANDLE, observed = new Map(this.handles), identities = new Map(this.v2Identities());identities.set(player,`${this.rows.step}:player`);
    return { players: [{ identity: `${this.rows.step}:player`,handle: player,atTick: this.tick,pose: { ...this.point,yaw: this.playerYaw } }],
      bindings: this.v2Bindings.map(({ binding }) => {
        const self = this.actor(binding.self), slot = this.rows.slots.findIndex(row => row.handle === binding.self);
        const values = new Map((due.has(binding.id) ? columns.capture({ ...owners,self: { group: this.rows.roster,slot: Math.max(0,slot),identity: self?.entityId ?? '',actor: self ?? null },observed,player: { position: this.point },t: this.tick/60,dt: 1/60 }) : []).map(row => [row.name,row.value]));
        return { id: binding.id,observed: identities,fields: this.rows.fields.map((row,index) => {
          const n = values.get(row.id) ?? (row.source === 'observed' ? this.observations.get(row.id) : this.field(binding.self,index+1));
          return { name: row.id,id: index+1,...(n === undefined ? {} : { value: n }) };
        }),sample: { atTick: this.tick,target: player,...(self === undefined ? {} : { pose: { x: self.position.x,y: self.position.y,z: self.position.z,yaw: self.yaw },hpShare: self.hp/self.maxHp }) } };
      }) };
  }
  private observational(handle: number): boolean { return this.observingSlots.has(handle); }
  private actor(handle: number): ControlledBody | undefined { return this.handles.get(handle); }
  /** The player `body` deals with: in a room the one nearest it; alone, the frame's point. */
  private foe(body: { readonly position: Point }): Point {
    const host = this.nativeHost;
    return host === undefined || host.players.size === 1 ? this.point : host.nearestPlayer(body.position).position;
  }
  /** Where the roster stands, for the one player the script reads: its first body, if it has one. */
  get standing(): Point | undefined { for (const body of this.handles.values()) if (body.alive) return body.position; return undefined; }
  private position(handle: number): Point { return handle === DECISION_PLAYER_HANDLE ? this.point : this.actor(handle)?.position ?? { x: 0, y: 0, z: 0 }; }
  private field(actor: number, id: number): number {
    const row = value(this.rows.fields[id - 1], 'field'), body = this.actor(actor);
    if (row.source === 'night') return this.night;
    if (row.source === 'limit') return this.maximum;
    if (row.source === 'force') return this.forced;
    if (row.source === 'scripted') return Number(body?.scripted ?? false);
    if (row.source === 'lookWeight') return body?.lookWeight ?? 0;
    if (row.source === 'hidden') return Number(body?.hidden ?? false);
    if (row.source === 'seed') return body?.seed ?? 0;
    if (row.source === 'lastHit') return Number.isFinite(body?.lastHitT) ? body?.lastHitT ?? 0 : row.fallback ?? 0;
    if (row.source === 'strikeTime') return this.combat.time(actor);
    if (row.source === 'observed') return this.observations.get(row.id) ?? 0;
    if (row.source === 'channel') return this.channel(this.registries.channels?.get(row.channel ?? '') ?? 0);
    return this.fields.get(this.fieldKey(actor, id)) ?? 0;
  }
  private fieldKey(actor: number, id: number): string {
    const n = actor * 65536 + id; let key = this.fieldKeys.get(n);
    if (key === undefined) { key = `${actor}:${id}`; this.fieldKeys.set(n, key); }
    return key;
  }
  private read(op: number, a: number, b: number): number {
    if (op === 9) return DECISION_PLAYER_HANDLE;
    if (op === 10) return Number(this.flags.has(value(this.rows.flags[a - 1], 'flag')));
    if (op === 7) return this.field(a, b);
    if (op === 16) return ['idle', 'windup', 'active', 'recover', 'cooldown'].indexOf(this.combat.state(a));
    if (op === 18) {
      const spawn = this.rows.spawns[a - 1], site = this.rows.sites.find(row => row.id === spawn?.site);
      if (site !== undefined) return Number(this.body(site.slot)?.alive ?? false);
      const binding = this.rows.script.binding;
      if (!('spawnGroup' in binding) || a !== (this.rows.spawns.length + 1)) throw new Error('Missing declared spawn group');
      return [...this.handles.values()].filter(body => body.alive).length;
    }
    if (op === 15) return Number(this.motions.has(a));
    const body = this.actor(a), point = this.position(a);
    if (op === 1) return point.x; if (op === 2) return point.y; if (op === 3) return point.z;
    if (op === 4) return a === DECISION_PLAYER_HANDLE ? this.playerYaw : body?.yaw ?? 0;
    if (op === 5) return body === undefined ? 0 : body.hp / body.maxHp;
    if (op === 6) return Number(body?.alive ?? false);
    if (op === 8) { const other = this.position(b); return Math.hypot(point.x - other.x, point.z - other.z); }
    throw new Error('Unsupported population read');
  }
  private fieldBounds(id: string, n: number): void {
    for (const move of this.rows.moves) {
      if (move.kind !== 'steer') continue;
      if (id === move.fields.speed && (n < 0 || n > move.speed)) throw new Error('Script steering speed bounds');
      if (id === move.fields.turn && (n < 0 || n > move.turn)) throw new Error('Script steering turn bounds');
    }
  }
  /** Validate the complete batch and resolve its row/species/site identities before any draw, body or flag changes. */
  private prepare(commands: readonly ScriptV1Command[], context: DecisionContext): { commit: () => void } {
    const operations = this.prepareOperations(commands,context);
    return { commit: () => { for (const operation of operations) operation(); } };
  }
  private prepareExternal(commands: readonly DecisionExternalCommand[],context: DecisionContext): { commit: () => void } {
    const capabilities = value(this.rows.v2?.effects,'external effect declaration'),owners = value(this.v2Owners,'external effect owners');
    const elites = capabilities.elites === true ? value(this.effectOwners?.elites,'entered elite owner') : undefined;
    // Preserve declaration indices, including holes. Never use manager order or
    // re-read controller.animal after an earlier emitted adoption.
    const actors: readonly (Animal | null)[] = elites === undefined ? [] : this.rows.slots.map(slot => {
      const body = this.handles.get(slot.handle);if (body === undefined) return null;
      const actual = this.bodies.pageActor?.(body.entityId);
      if (actual !== body) throw new Error('Foreign page effect actor');return actual;
    });
    const actorRows: ScriptV1Command[] = [],worldRows: V2WorldAction[] = [],eliteRows: EliteOutput[] = [];
    const order: { readonly kind: 'actor' | 'world' | 'elite'; readonly index: number }[] = [];
    const world = capabilities.world;
    const rights: V2ActionBinding | undefined = world === undefined ? undefined : { identity: String(context.binding.id),handle: context.binding.id,
      targets: new Map(world.targets.map(row => [row.handle,{ identity: row.identity,kind: row.kind }])),operations: new Set(world.operations),maxCommands: world.maxCommands,bounds: world.bounds };
    const wire = new DataView(new ArrayBuffer(64));
    for (const command of commands) {
      const [op,target,a,b,c,d] = command;
      if ([1,2,3,4,5,6,7,12,13].includes(op)) {
        if (!Object.is(d,0)) throw new Error('Native actor command padding');
        // Physical fight commands keep their original native phase. A new page
        // controller observes those bodies and emits only page-drain effects.
        if (elites !== undefined && op !== 7 && op !== 13) throw new Error('Page actor operation requires native phase');
        order.push({ kind: 'actor',index: actorRows.length });actorRows.push([op,target,a,b,c]);continue;
      }
      new Uint8Array(wire.buffer).fill(0);wire.setUint32(0,context.binding.id,true);wire.setUint32(4,op,true);wire.setUint32(8,target,true);
      [a,b,c,d].forEach((n,index) => wire.setFloat64(16+index*8,n,true));
      if (Object.values(V2_ACTION_OPS).some(operation => operation === op)) {
        order.push({ kind: 'world',index: worldRows.length });worldRows.push(readV2WorldAction(wire,0,rights));continue;
      }
      if (op === ELITE_OUTPUT_OPERATION && elites !== undefined) {
        order.push({ kind: 'elite',index: eliteRows.length });eliteRows.push(readEliteOutputV2(wire,0,context.binding.id,elites.v2OutputActions,actors.length));continue;
      }
      throw new Error('Undeclared external effect operation');
    }
    if (worldRows.length > (world?.maxCommands ?? 0)) throw new Error('World effect binding quota');
    const actorOperations = this.prepareOperations(actorRows,context);
    const preparedWorld = world === undefined ? undefined : prepareV2WorldActions(worldRows,value(this.effectOwners?.world,'world effect loans'));
    const preparedElite = elites?.prepareV2Outputs(eliteRows,actors);
    const validate = (): void => {
      if (owners.scope.disposed || owners.scope.disposing) throw new Error('Retired external effect scope');
      if (elites !== undefined) for (const [index,slot] of this.rows.slots.entries()) {
        const before = actors[index] ?? null,now = this.handles.get(slot.handle) ?? null;
        if (now !== before || (before !== null && this.bodies.pageActor?.(before.entityId) !== before)) throw new Error('Replaced page effect actor slot');
      }
      preparedWorld?.validate();preparedElite?.validate();
    };
    const operations = order.map(row => {
      const operation = value(row.kind === 'actor' ? actorOperations[row.index] : row.kind === 'world' ? preparedWorld?.operations[row.index] : preparedElite?.operations[row.index],'prepared external operation');
      return (): void => {
        if (owners.scope.disposed || owners.scope.disposing) throw new Error('Retired external effect scope');
        operation();
      };
    });
    validate();
    const bank: PreparedSpawnPageBank = { validate,operations: Object.freeze(operations) };
    return { commit: () => {
      validate();
      if (elites !== undefined) this.effects.push({ kind: 'page-bank',bank });
      else for (const operation of operations) operation();
    } };
  }
  private prepareOperations(commands: readonly ScriptV1Command[], context: DecisionContext): readonly (() => void)[] {
    const fields = new Map(this.fields), pending = new Set<number>(), retiring = new Set<number>(), operations: (() => void)[] = [];
    let capacity = this.bodies.available();
    const slot = (name: string): number => value(this.rows.slots.find(row => row.id === name), 'slot').handle;
    for (const [op, actor, a, b, c] of commands) {
      if ([1,2,3,4,6].includes(op) && this.observational(actor)) throw new Error('Read-only actor authority');
      if (op === 4) {
        const row = value(this.rows.fields[a - 1], 'field'); this.fieldBounds(row.id, b);
        if (['night', 'limit', 'observed', 'channel', 'seed', 'lastHit', 'strikeTime'].includes(row.source) || Math.abs(b) > 10000 || c !== 0) throw new Error('Population field authority');
        if ((row.source === 'scripted' || row.source === 'hidden') && b !== 0 && b !== 1) throw new Error('Population control bounds');
        if (row.source === 'lookWeight' && (b < 0 || b > 1)) throw new Error('Look weight bounds');
        if (row.source === 'force' && (b < 0 || b > 8 || !Number.isInteger(b))) throw new Error('Population force bound');
        if (['scripted', 'lookWeight', 'hidden'].includes(row.source) && !pending.has(actor) && this.actor(actor) === undefined) throw new Error('Missing controlled body');
        fields.set(`${actor}:${a}`, b);
        operations.push(() => {
          const body = this.actor(actor);
          if (row.source === 'force') this.forced = b;
          else if (row.source === 'scripted') {
            if (body === undefined) throw new Error('Missing controlled body');
            body.scripted = b === 1;
            const state = this.controlState;
            if (body.scripted) { body.herd = -1; body.state = state; }
            else if (body.alive && body.state === state) body.state = 'alert';
            if (!body.scripted && this.rows.slots.find(item => item.handle === actor)?.release === 'detach') this.detach(actor);
          } else if (row.source === 'lookWeight') { if (body !== undefined) body.lookWeight = b; }
          else if (row.source === 'hidden') { if (body !== undefined) { body.hidden = b === 1; this.bodies.show?.(body, b === 0); } }
          else if (row.source === 'lookHeight') this.fields.set(`${actor}:${a}`, b);
          else this.fields.set(`${actor}:${a}`, b);
          if ('spawnGroup' in this.rows.script.binding && ['hidden', 'lookWeight', 'scripted'].includes(row.source)) this.fields.set(`${actor}:${a}`, b);
        });
      } else if (op === 5) {
        const row = value(this.rows.spawns[a - 1], 'spawn row'), species = value(this.rows.species.find(item => item.id === row.species), 'species');
        const site = value(this.rows.sites.find(item => item.id === row.site), 'site'), handle = slot(site.slot);
        if (this.observational(handle) || b !== 0 || c !== 0 || pending.has(handle) || (this.actor(handle)?.alive === true && !retiring.has(handle)) || capacity < 1) throw new Error('Occupied or invalid spawn slot');
        if ('spawnGroup' in this.rows.script.binding && handle !== context.binding.self) throw new Error('Spawn group slot ownership');
        capacity--;
        const coordinate = (source: 'x' | 'z'): number => {
          const id = this.rows.fields.findIndex(field => field.source === source) + 1;
          return value(fields.get(`${handle}:${id}`), 'dynamic site coordinate');
        };
        const x = site.point?.[0] ?? coordinate('x'), z = site.point?.[1] ?? coordinate('z');
        if (![x, z].every(n => Number.isFinite(n) && Math.abs(n) <= 10000)) throw new Error('Spawn site bound');
        pending.add(handle);
        operations.push(() => {
          const face = site.face === 'player' ? this.point : { x: site.face[0], z: site.face[1] };
          const body = this.bodies.spawn(species.kind, x, z, Math.atan2(face.x - x, face.z - z), species.variant);
          this.handles.set(handle, body); if ('spawnGroup' in this.rows.script.binding) claimedBodies.set(body, this); this.motions.delete(handle);
          if ('spawnGroup' in this.rows.script.binding) { body.scripted = true; body.herd = -1; body.state = this.controlState; }
          if (this.rows.script.on.includes('spawned')) this.enqueue(handle, [17, handle, a, 0, 0, 0]);
        });
      } else if (op === 6) {
        const body = value(this.actor(actor), 'retirement body');
        if (retiring.has(actor)) throw new Error('Duplicate population retirement');
        retiring.add(actor); capacity++;
        operations.push(() => { this.effects.push({ kind: 'retire', id: actor, actor, at: { x: body.position.x, y: body.position.y, z: body.position.z } });
          this.bodies.retire(body); this.detach(actor); });
      } else if (op === 1) {
        const row = value(this.rows.moves[a - 1], 'move');
        if (!['stalk', 'steer', 'relocate'].includes(row.kind)) throw new Error('Unsupported owned movement');
        if (!pending.has(actor) && this.actor(actor) === undefined) throw new Error('Missing moving actor');
        if (b !== DECISION_PLAYER_HANDLE && b !== 0) throw new Error('Population move target');
        operations.push(() => {
          const body = value(this.actor(actor), 'move body'), runner = new ActorMoveRunner(row, body);
          if (row.kind !== 'relocate') { this.motions.set(actor, { id: a, target: b, runner }); return; }
          const site = this.rows.sites.find(item => this.rows.slots.find(owned => owned.id === item.slot)?.handle === actor), face = site?.face;
          const target = b !== 0 ? this.position(b) : face === undefined || face === 'player' ? this.foe(body) : { x: face[0], y: body.position.y, z: face[1] };
          const destination = row.point.kind === 'fields' ? { x: this.namedField(actor, row.point.x), z: this.namedField(actor, row.point.z) } : undefined;
          const frame = runner.step({ body, target, ...(destination === undefined ? {} : { destination }) });
          if (frame.placement !== undefined) { const at = frame.placement; body.place(at.x, at.z, at.yaw, at.y); }
          this.motions.delete(actor);
          if (frame.done !== undefined && this.rows.script.on.includes('move.done')) this.enqueue(actor, [10, actor, a, Number(frame.done), 0, 0]);
        });
      } else if (op === 2) {
        value(this.rows.strikes?.[a - 1], 'strike');
        if (b !== DECISION_PLAYER_HANDLE || c !== 0 || this.actor(actor) === undefined) throw new Error('Invalid scripted strike target');
        operations.push(() => { this.motions.delete(actor);
          for (const cue of this.combat.start(actor, a, value(this.actor(actor), 'strike actor'), this.foe(value(this.actor(actor), 'strike actor')))) this.emitCue(actor, cue); });
      } else if (op === 3) {
        operations.push(() => { this.combat.cancel(actor, this.actor(actor)); this.motions.delete(actor); const body = this.actor(actor); body?.setMotion(body.yaw, 0); });
      } else if (op === 7) {
        const name = value(this.rows.flags[a - 1], 'flag'); operations.push(() => { if (b === 1) this.flags.add(name); else this.flags.delete(name); });
      } else if (op === 12) {
        value(this.rows.cues[a - 1], 'cue'); operations.push(() => { this.effects.push({ kind: 'cue', id: a, actor, at: { ...this.position(actor) } }); });
      } else if (op === 13) {
        value(this.rows.channels[a - 1], 'channel'); operations.push(() => { this.channels.set(a, b); });
      } else throw new Error('Unsupported population command');
    }
    return operations;
  }
  /** Existing native/page owners supply observations as values; the guest cannot call back into shard code. */
  advance(dt: number, point: Point, night: number, maximum: number, flags: readonly string[]): void {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1) throw new Error('Invalid population elapsed time');
    if (this.v2Owners?.scope.disposed || this.v2Owners?.scope.disposing) throw new Error('Retired v2 actor scope');
    if (this.v2 !== undefined && ![point.x,point.y,point.z,night,maximum].every(Number.isFinite)) throw new Error('Invalid v2 actor frame');
    if (this.v2 !== undefined && [...this.handles.values()].some(body => this.bodies.actor(body.entityId) !== body)) throw new Error('Retired v2 actor identity');
    this.point = point; this.night = night; this.maximum = maximum;
    this.flags.clear(); for (const flag of flags) this.flags.add(flag);
    this.elapsed += dt;
    while (this.elapsed + Number.EPSILON >= 1 / 60) {
      this.elapsed = Math.max(0, this.elapsed - 1 / 60);
      if (this.v2 === undefined) this.host.step(++this.tick);
      else {
        this.host.stepExternal(++this.tick);
        this.v2.advance(this.tick,due => this.captureV2(due),this.v2Identities());
        this.disabledReason = this.v2.failure?.message ?? null;
      }
      for (const [handle, motion] of this.motions) {
        const body = this.actor(handle); if (body === undefined || !body.alive) { this.motions.delete(handle); continue; }
        let site = this.motionSites.get(handle);
        if (site === undefined && !this.motionSites.has(handle)) { site = this.rows.sites.find(row => this.rows.slots.find(slot => slot.id === row.slot)?.handle === handle); this.motionSites.set(handle, site); }
        const face = site?.face;
        const target = motion.target !== 0 ? this.position(motion.target) : face === undefined || face === 'player' ? this.foe(body) : { x: face[0], y: body.position.y, z: face[1] };
        const move = value(this.rows.moves[motion.id - 1], 'owned motion');
        const controls = move.kind === 'steer' ? { yaw: this.namedField(handle, move.fields.yaw), speed: this.namedField(handle, move.fields.speed), turn: this.namedField(handle, move.fields.turn) } : undefined;
        const destination = move.kind === 'relocate' && move.point.kind === 'fields' ? { x: this.namedField(handle, move.point.x), z: this.namedField(handle, move.point.z) } : undefined;
        const frame = motion.runner.step({ body, target, ...(controls === undefined ? {} : { controls }), ...(destination === undefined ? {} : { destination }) });
        if (frame.placement !== undefined) { const at = frame.placement; body.place(at.x, at.z, at.yaw, at.y); }
        if (frame.steering !== undefined) { const steer = frame.steering; body.setMotion(steer.yaw, steer.speed, steer.turn); }
        if (frame.done !== undefined) { this.motions.delete(handle); if (this.rows.script.on.includes('move.done')) this.enqueue(handle, [10, handle, motion.id, Number(frame.done), 0, 0]); }
      }
      for (const [handle, body] of this.handles) {
        if (this.observational(handle)) continue;
        const foe = this.foe(body);
        if ('spawnGroup' in this.rows.script.binding) { body.lookTarget.set(foe.x, foe.y + this.sourceField(handle, 'lookHeight'), foe.z); }
        const frame = this.combat.advance(handle, 1 / 60, body, foe, () => this.bodies.reach(body, foe));
        if (frame.hit !== null) this.effects.push({ kind: 'hit', actor: handle, hit: frame.hit });
        for (const cue of frame.cues) this.emitCue(handle, cue);
      }
    }
  }
  private compatible(handle: number, body: AnimalSim): boolean {
    const slot = this.rows.slots.find(row => row.handle === handle);
    return slot !== undefined && this.rows.spawns.some(spawn => {
      const site = this.rows.sites.find(row => row.id === spawn.site), species = this.rows.species.find(row => row.id === spawn.species);
      return site?.slot === slot.id && species?.kind === body.kind && species.variant === body.variant;
    });
  }
  private namedField(handle: number, name: string): number { return this.field(handle, this.registries.fields?.get(name) ?? 0); }
  private sourceField(handle: number, source: SpawnScriptRows['fields'][number]['source']): number {
    const id = this.sourceFields.get(source); return id === undefined ? 0 : this.field(handle, id);
  }
  private enqueue(actor: number, event: Parameters<DecisionHost['enqueue']>[1]): void {
    const binding = value(this.bindings.get('spawnGroup' in this.rows.script.binding ? actor : 0), 'binding actor');
    if (this.v2 === undefined) this.host.enqueue(binding,event);
    else if (this.rows.script.on.some(name => SCRIPT_V1_EVENTS[name] === event[0])) this.v2.enqueue(this.tick,binding,event,this.v2Identities());
  }
  private emitCue(actor: number, name: string): void {
    const id = this.registries.cues?.get(name) ?? 0; if (id < 1) throw new Error('Missing owned cue');
    this.effects.push({ kind: 'cue', actor, id, at: { ...this.position(actor) } });
  }
  private detach(handle: number): void {
    const body = this.actor(handle); if (body !== undefined && claimedBodies.get(body) === this) claimedBodies.delete(body);
    this.combat.cancel(handle, body); this.motions.delete(handle); this.handles.delete(handle);
  }
  /** Resolve an actual body only inside this owner's declared slot catalogue. */
  body(slot: string | number): AnimalSim | null {
    const handle = typeof slot === 'number' ? slot : value(this.registries.actors?.get(slot), 'slot');
    return this.actor(handle) ?? null;
  }
  cue(id: number): string { return value(this.rows.cues[id - 1], 'cue identity'); }
  strikePresentation(): ReturnType<ScriptStrikes['presentation']> { return this.combat.presentation(); }
  state(slot: string): Readonly<Record<string, number | boolean>> {
    const handle = value(this.rows.slots.find(row => row.id === slot), 'state slot').handle;
    const binding = value(this.bindings.get('spawnGroup' in this.rows.script.binding ? handle : 0), 'state binding');
    return value(this.host.snapshot().bindings.find(row => row.id === binding), 'binding state').slots;
  }
  /** Explicit adoption takes an id, never a body supplied by content or a reflected object path. */
  adopt(slot: string, id: string): void {
    const handle = value(this.rows.slots.find(row => row.id === slot), 'adopted slot').handle, body = this.bodies.actor(id);
    if (body === null || !this.compatible(handle, body) || (!this.observational(handle) && claimedBodies.has(body) && claimedBodies.get(body) !== this)) throw new Error('Incompatible adopted script actor');
    this.handles.set(handle, body);
    if (this.observational(handle)) return;
    claimedBodies.set(body, this); this.adoptedBodies.add(body);
    body.scripted = true; body.herd = -1; body.state = this.controlState;
  }
  /** Encounter lifecycle activation uses the same recipe/site/real roster authority as guest spawning. */
  activate(recipe: string, yaw: number): AnimalSim {
    if (!Number.isFinite(yaw)) throw new Error('Invalid activation yaw');
    const spawn = value(this.rows.spawns.find(row => row.id === recipe), 'activation recipe'), site = value(this.rows.sites.find(row => row.id === spawn.site), 'activation site');
    const slot = value(this.rows.slots.find(row => row.id === site.slot), 'activation slot'), species = value(this.rows.species.find(row => row.id === spawn.species), 'activation species');
    if (this.observational(slot.handle) || site.point === undefined || this.actor(slot.handle)?.alive === true) throw new Error('Invalid lifecycle site or occupied slot');
    this.interrupt(); this.detach(slot.handle); this.fields.clear(); this.channels.clear();
    const initial = this.host.snapshot(), bindings: DecisionSnapshot['bindings'][number][] = [];
    for (const binding of initial.bindings) bindings.push({ ...binding, slots: Object.fromEntries(this.rows.script.state.map(row => [row.name, row.default])),
      timers: {}, pending: [], lastCall: initial.tick, failures: 0, disabled: false,...(this.v2 === undefined ? {} : { enabled: true }) });
    this.host.restore({ ...initial, bindings, staged: [] });
    this.v2?.clearInput(true);
    const boot = this.bodies.boot().find(body => this.compatible(slot.handle, body) && !claimedBodies.has(body) && !this.adoptedBodies.has(body));
    const body = boot ?? this.bodies.spawn(species.kind, site.point[0], site.point[1], yaw, species.variant);
    this.adopt(slot.id, body.entityId); this.enqueue(slot.handle, [1, 0, 0, 0, 0, 0]); return body;
  }
  retire(slot: string): void {
    const handle = value(this.rows.slots.find(row => row.id === slot), 'retired slot').handle, body = this.actor(handle);
    if (this.observational(handle)) throw new Error('Read-only actor retirement');
    if (body !== undefined) this.bodies.retire(body); this.detach(handle); this.interrupt();
  }
  interrupt(): void {
    const initial = this.host.snapshot(), bindings: DecisionSnapshot['bindings'][number][] = [];
    for (const binding of initial.bindings) bindings.push({ ...binding, pending: [] });
    this.host.restore({ ...initial, bindings, staged: [] });
    this.v2?.clearInput();
    for (const [handle, body] of this.handles) {
      if (this.observational(handle)) continue;
      this.combat.cancel(handle, body); this.motions.delete(handle); body.setMotion(body.yaw, 0);
      const hidden = this.rows.fields.findIndex(row => row.source === 'hidden') + 1;
      if (hidden > 0) { body.hidden = false; this.bodies.show?.(body, true); this.fields.set(`${handle}:${hidden}`, 0); }
      if (this.rows.slots.find(row => row.handle === handle)?.release === 'detach') {
        body.scripted = false; if (body.alive && body.state === this.controlState) body.state = 'alert'; this.detach(handle);
      }
    }
  }
  signal(slot: string, n: number): void {
    if (!Number.isFinite(n)) throw new Error('Invalid script signal');
    const handle = value(this.rows.slots.find(row => row.id === slot), 'signal slot').handle;
    this.enqueue(handle, [13, 0, n, 0, 0, 0]);
  }
  /** Platform observations are finite named values. Only fields declared as observed can receive them. */
  observe(input: Readonly<Record<string, number>>): void {
    const entries = Object.entries(input);
    for (const [id, n] of entries) {
      if (this.columnFields.has(id)) throw new Error('Duplicate v2 observation publication');
      if (!Number.isFinite(n) || !this.observedFields.has(id)) throw new Error('Invalid script observation');
    }
    for (const [id,n] of entries) this.observations.set(id,n);
  }
  frame(point: Point, night: number, observations: Readonly<Record<string, number>>, yaw = 0): void {
    if (this.v2 !== undefined && ![point.x,point.y,point.z,night,yaw].every(Number.isFinite)) throw new Error('Invalid v2 actor frame');
    // Snapshot every supplied value before validating or publishing, just as
    // the former spread/filter/observe chain did (including ignored getters).
    const entries = Object.entries({ ...observations, night });
    for (const [id, n] of entries) if (this.observedFields.has(id)) {
      if (this.columnFields.has(id)) throw new Error('Duplicate v2 observation publication');
      if (!Number.isFinite(n)) throw new Error('Invalid script observation');
    }
    for (const [id, n] of entries) if (this.observedFields.has(id)) this.observations.set(id, n);
    this.point = point;this.night = night;this.playerYaw = yaw;
  }
  advanceFrame(dt: number): void {
    this.frameFlags.length = 0;
    for (const flag of this.rows.flags) if (this.flags.has(flag)) this.frameFlags.push(flag);
    this.advance(dt, this.point, this.night, this.rows.maximum, this.frameFlags);
  }
  /** Preflight the same native authority without a body write or guest call. */
  prepareRestore(input: SimValue): () => void {
    this.restoreSnapshot(input,true);
    return () => { this.restore(input); };
  }
  /** Historical controller state enters through finite named values and actual roster ids, never reflected ports. */
  prepareLegacy(input: unknown): () => void {
    const legacy = v.parse(v.strictObject({ actors: v.array(v.strictObject({ slot: v.string(), id: v.string(),
      state: v.record(v.string(), v.union([finite, v.boolean()])), rng: v.exactOptional(natural) })),
      fields: v.array(v.strictObject({ slot: v.string(), field: v.string(), value: finite })), strikes: v.array(v.unknown()) }), input);
    const decision = this.host.snapshot(), actors: [number, string][] = [];
    const state = new Map<number, typeof legacy.actors[number]>();
    for (const row of legacy.actors) {
      const handle = value(this.rows.slots.find(slot => slot.id === row.slot), 'historical actor slot').handle;
      if (state.has(handle)) throw new Error('Duplicate historical actor'); state.set(handle, row); actors.push([handle, row.id]);
    }
    const bindings = decision.bindings.map(binding => {
      const handle = [...this.bindings].find(([, id]) => id === binding.id)?.[0] ?? 0, row = state.get(handle);
      if (row === undefined) return { ...binding, pending: [] };
      if (Object.keys(row.state).some(key => !Object.hasOwn(binding.slots, key))) throw new Error('Unknown historical state');
      return { ...binding, slots: { ...binding.slots, ...row.state }, rng: row.rng ?? binding.rng, pending: [] };
    });
    const fields = legacy.fields.map(row => [value(this.rows.slots.find(slot => slot.id === row.slot), 'historical field actor').handle,
      this.rows.fields.findIndex(field => field.id === row.field) + 1, row.value]);
    return this.prepareRestore(JSON.stringify({ version: 2, contract: this.contract, decision: { ...decision, bindings, staged: [] },
      actors, fields, channels: [], strikes: legacy.strikes, force: 0, elapsed: 0, moves: [] }));
  }
  /** Debug force is a bounded input; normal decision cadence and spawn quotas still apply. */
  force(): void { this.forced = Math.min(8, this.maximum || this.rows.maximum); }
  channel(id: number): number { return this.channels.get(id) ?? 0; }
  hasFlag(name: string): boolean { return this.flags.has(name); }
  drainEffects(): readonly Effect[] { if (this.effects.length === 0) return NO_EFFECTS; const effects = this.effects; this.effects = []; return effects; }
  snapshot(): string { return JSON.stringify({ version: 2, contract: this.contract, decision: this.host.snapshot(),
    actors: [...this.handles].map(([handle, body]) => [handle, body.entityId]),
    ...(this.rows.strikes === undefined ? {} : { strikes: this.combat.snapshot() }),
    fields: [...this.fields].map(([key, n]) => { const parts = key.split(':'); return [Number(parts[0]), Number(parts[1]), n]; }), channels: [...this.channels], force: this.forced, elapsed: this.elapsed,
    moves: [...this.motions].map(([actor, motion]) => ({ actor, id: motion.id, target: motion.target, state: motion.runner.snapshot() })),
    ...(this.v2 === undefined ? {} : { v2Input: { version: 1,contract: this.v2Contract,...this.v2.snapshot() } }) }); }
  /** Restore body references only after the real roster has reinstalled them. No draws, spawns, guest calls or effects. */
  restore(input: SimValue): void { this.restoreSnapshot(input,false); }
  private restoreSnapshot(input: SimValue,validateOnly: boolean): void {
    const raw: unknown = typeof input === 'string' ? JSON.parse(input) : input;
    const migrated = this.migrate(raw), saved = v.parse(Saved, migrated);
    if (saved.contract !== this.contract) throw new Error('Incompatible population script continuation');
    if (saved.v2Input !== undefined && (this.rows.v2 === undefined || saved.v2Input.contract !== this.v2Contract)) throw new Error('Incompatible v2 actor input contract');
    const fields = new Map<string, number>(), channels = new Map<number, number>();
    for (const [actor, id, n] of saved.fields) {
      const field = value(this.rows.fields[id - 1], 'restored field'), key = `${actor}:${id}`; this.fieldBounds(field.id, n);
      if (this.observational(actor) || !this.rows.slots.some(row => row.handle === actor) || !['x', 'z', ...('spawnGroup' in this.rows.script.binding ? ['value', 'lookHeight', 'lookWeight', 'hidden', 'scripted'] : [])].includes(field.source) || fields.has(key) || Math.abs(n) > 10000) throw new Error('Invalid population site continuation');
      if (['scripted', 'hidden'].includes(field.source) && n !== 0 && n !== 1) throw new Error('Invalid restored visibility');
      if (field.source === 'lookWeight' && (n < 0 || n > 1)) throw new Error('Invalid restored look weight');
      fields.set(key, n);
    }
    for (const [id, n] of saved.channels) {
      if (!Number.isInteger(id) || this.rows.channels[id - 1] === undefined || channels.has(id)) throw new Error('Invalid population channel continuation');
      channels.set(id, n);
    }
    const actors = new Map<number, ControlledBody>();
    for (const [handle, id] of saved.actors) {
      const body = this.bodies.actor(id);
      if (body === null || actors.has(handle) || !this.rows.slots.some(row => row.handle === handle) || [...actors.values()].includes(body)) throw new Error('Invalid population actor continuation');
      if (!this.compatible(handle, body) || (!this.observational(handle) && claimedBodies.get(body) !== undefined && claimedBodies.get(body) !== this)) throw new Error('Foreign scripted actor continuation');
      actors.set(handle, body);
    }
    const motions = new Map<number, Motion>();
    for (const motion of saved.moves) {
      const body = value(actors.get(motion.actor), 'restored moving actor'), row = value(this.rows.moves[motion.id - 1], 'restored move');
      if (this.observational(motion.actor) || motions.has(motion.actor) || (motion.target !== 0 && motion.target !== DECISION_PLAYER_HANDLE) || !['stalk', 'steer', 'relocate'].includes(row.kind)) throw new Error('Invalid population move continuation');
      const runner = new ActorMoveRunner(row, body); runner.restore(motion.state); motions.set(motion.actor, { ...motion, runner });
    }
    const commitStrikes = this.combat.prepareRestore(saved.strikes ?? [], new Set([...actors.keys()].filter(handle => !this.observational(handle))));
    const before = new Map(this.handles), previousFields = new Map(this.fields);
    this.handles.clear(); for (const [id, body] of actors) this.handles.set(id, body);
    this.fields.clear(); for (const [key, n] of fields) this.fields.set(key, n);
    let publish: () => void;
    try {
      publish = this.v2 === undefined ? this.host.prepareRestore(saved.decision) : this.v2.prepareRestore(saved.decision,saved.v2Input,this.v2Identities());
    } finally {
      this.handles.clear(); for (const [id, body] of before) this.handles.set(id, body);
      this.fields.clear(); for (const [key, n] of previousFields) this.fields.set(key, n);
    }
    if (validateOnly) return;
    this.handles.clear();for (const [id,body] of actors) this.handles.set(id,body);
    this.fields.clear();for (const [key,n] of fields) this.fields.set(key,n);
    publish();commitStrikes(); this.tick = this.host.snapshot().tick;
    for (const [handle, body] of before) if (!actors.has(handle) && claimedBodies.get(body) === this) claimedBodies.delete(body);
    if ('spawnGroup' in this.rows.script.binding) for (const [handle,body] of actors) if (!this.observational(handle)) { claimedBodies.set(body, this); this.adoptedBodies.add(body); }
    for (const [key, n] of fields) { const [actor, id] = key.split(':').map(Number), row = this.rows.fields[(id ?? 0) - 1], body = actors.get(actor ?? 0);
      if (row?.source === 'hidden' && body !== undefined && !this.observational(actor ?? 0)) { body.hidden = n === 1; this.bodies.show?.(body, n === 0); }
    }
    this.channels.clear(); for (const [id, n] of channels) this.channels.set(id, n);
    this.motions.clear(); for (const [id, motion] of motions) this.motions.set(id, motion); this.forced = saved.force; this.elapsed = saved.elapsed; this.effects = [];
  }
  private migrate(input: unknown): unknown {
    if (typeof input !== 'object' || input === null || !('version' in input) || input.version !== 1) return input;
    const mapping = value(this.rows.legacy, 'legacy map'), record = v.record(v.string(), v.unknown());
    const old = v.parse(v.strictObject({ version: v.literal(1), population: record, rng: v.strictObject({ version: v.literal(1),
      state: natural, initial: natural, scrambledFork: v.literal(false) }) }), input);
    if (old.population['version'] !== 2 || old.population['spec'] !== mapping.spec || old.rng.initial !== new Rng(this.rows.seed).fork(this.rows.step).snapshot().initial
      || old.rng.state > 0xffffffff) throw new Error('Incompatible legacy population');
    const initial = this.host.snapshot(), binding = initial.bindings[0]; if (binding === undefined) throw new Error('Missing population binding');
    const slots = { ...binding.slots }, actors: [number, string][] = [];
    slots[mapping.acc] = v.parse(finite, old.population['acc']); slots[mapping.rng] = old.rng.state;
    for (const group of mapping.groups) {
      const entries = v.parse(v.array(record), old.population[group.key]);
      if (entries.length > group.slots.length) throw new Error('Legacy population exceeds slots');
      slots[group.active] = (1 << entries.length) - 1;
      for (const [index, entry] of entries.entries()) {
        const slot = value(this.rows.slots.find(row => row.id === group.slots[index]), 'legacy slot'), id = v.parse(v.string(), entry['id']);
        const body = this.bodies.actor(id);
        if (body === null || !this.rows.species.some(row => row.kind === body.kind && row.variant === body.variant)) throw new Error('Incompatible legacy actor');
        actors.push([slot.handle, id]);
        slots[value(group.values[index], 'legacy state')] = group.type === 'bool' ? v.parse(v.boolean(), entry[group.value]) : v.parse(finite, entry[group.value]);
      }
    }
    // Active group masks are mapped as named slots; no shard names or wave thresholds live in the save owner.
    return { version: 2, contract: this.contract, decision: { ...initial, bindings: [{ ...binding, slots, pending: [] }] }, actors,
      fields: [], channels: [[this.rows.channels.indexOf(mapping.countChannel) + 1, actors.length]], force: 0, elapsed: 0, moves: [] };
  }
}

/** Built-in native adapter: row ids resolve the already installed roster; its actor IDs, draw order and save owner stay authoritative. */
export function installNativeSpawnScript(host: SimHost, day: Pick<DayCycleClock, 'night'>, input: unknown,v2Owners?: SpawnV2Owners,worldActions?: readonly V2WorldActionLoan[],queries?: SpawnQueryLoansV2): SpawnScript {
  const rows = parseSpawnScript(input), runner = SpawnScript.native(host, rows,v2Owners,worldActions,queries);
  // A quiet re-save preserves the validated input wire until the first simulation step.
  let restored: SimValue | undefined;
  const word = spawnCueWord(rows.step);
  host.onStep(rows.step, dt => {
    restored = undefined;
    runner.advance(dt, host.nearestPlayer(runner.standing ?? host.playerFocus).position, day.night, rows.maximum, rows.flags.filter(flag => host.flags.has(flag)));
    for (const flag of rows.flags) if (runner.hasFlag(flag) !== host.flags.has(flag)) host.flags.set(flag, runner.hasFlag(flag));
    // A page plays these: a thrall's call and its puff are this script's only voice.
    for (const effect of runner.drainEffects()) if (effect.kind === 'cue') sayFightView(host, word, [effect.id, effect.at.x, effect.at.y, effect.at.z]);
  }, { snapshot: () => restored ?? runner.snapshot(), restore: saved => { runner.restore(saved); restored = structuredClone(saved); } });
  return runner;
}

/** Resolve a spawn-owned catalogue row and its exact admitted module bytes before installing the synchronous owner. */
export async function readSpawnScript(product: ShardFolder, step: string, rawModules?: Map<string,Uint8Array>): Promise<SpawnScriptRows> {
  const rows = v.parse(SpawnScriptsSchema, product.section('actors/spawn-scripts'));
  const row = value(rows.find(item => item.step === step), 'catalogue step');
  const descriptor = value(outputDescriptor(product.shardfile), 'admitted product');
  const file = value(descriptor.index.files.find(item => item.kind === 'wasm' && item.path === row.script.module), 'catalogue module');
  const bytes = await product.file(value(file.name, 'named catalogue module'));
  if (row.v2 === undefined && rawModules !== undefined) { Map.prototype.set.call(rawModules,file.hash,bytes); return { ...row,bytes: '' }; }
  if (row.v2 === undefined) return { ...row, bytes: btoa(String.fromCodePoint(...bytes)) };
  const modulePath = `blobs/wasm/${row.v2.artifact.hash}.wasm`, modern = value(descriptor.index.files.find(item => item.kind === 'wasm' && item.path === modulePath && item.hash === row.v2?.artifact.hash), 'v2 catalogue module');
  const v2Bytes = await product.file(value(modern.name,'named v2 catalogue module'));
  return { ...row,bytes: btoa(String.fromCodePoint(...bytes)),v2: { ...row.v2,bytes: btoa(String.fromCodePoint(...v2Bytes)) } };
}
