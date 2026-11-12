import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { parseNativeLoadoutRow, type NativeLoadoutRowSchema } from '@wildshard/format/nativeItems';
import { borrowedDecisionAuthority } from '../shardfile/borrowedDecisions';
import { decisionRuntime, focusPlayer, ShardDecisions, type DecisionRuntime } from '../shardfile/decisions';
import { WorldTargetHost } from '../../../shared/game/shardfile/worldTargets';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { parseWorldTargets, worldTargetRules } from '@wildshard/format/worldTargets';
import { decisionScriptsFromSections } from '@wildshard/format/scriptContract';
import { prepareNativePopulation, type NativePopulationRows } from '../shardfile/bossRow';
import { serverReturnRows } from '../shardfile/nativeRuntimeLoans';
import { parseQuestWorldReactions, type QuestWorldReactionsData } from '@wildshard/format/questInteractions';
import { installQuestGraph, type QuestGraphPorts } from '../../../shared/game/plugin/quests';
import { parseQuestHost, type QuestHostRow } from '@wildshard/format/questHost';
import { parseBossOwnerRow } from '@wildshard/format/bossProfiles';
import type { QuestData } from '@wildshard/format/quests';
import { compileDirectorWhen, evaluateDirectorWhen } from '@wildshard/format/directorWhen';
import { weaponContactDistance, type ContactWorldTarget, ContactFamily, type ContactFamilyPorts, type ContactScanTarget } from '@wildshard/engine/combat/contactWeapon';
import { parseItems, parseMeleeContacts, parseNativeMeleeBinding } from '@wildshard/format/items';
import { scriptItemHook } from '@wildshard/engine/combat/items';
import { flagValue, test as testQuestFlags, type Flags } from '@wildshard/engine/world/interact/flags';
import { Vector3 } from 'three';
import { parsePromptRegistrations, createHeadlessPromptPicker } from '../../../shared/game/quest/interactionRows';
import { questBooks } from '@wildshard/engine/quest/players';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { GridSimulation } from '../grid/simulation';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { leadSnapshot, isSimHostRestoring, snapshotSimHost, regionalContinuation, type SimSnapshot } from '@wildshard/engine/sim/snapshot';
import { restoreSimHost, prepareSimHostRestore, type PreparedSimHostRestore } from '@wildshard/engine/sim/restore';
import { SaveStore } from '@wildshard/engine/saves/store';
import { Ledger } from '../../../shared/game/ledger';
import type { Material } from '@wildshard/engine/physics/surface';
import type { SocketLift } from '@wildshard/format/socketLift';
import { DirectorStageLane, bindDirectorActions, type DirectorActionBinding } from '../../../shared/game/plugin/director';
import { directorDayRange, directorDataHostIssues } from '@wildshard/format/directorStages';
import { DEFAULT_NORMALIZED_DAY, normalizedDayClock, inNormalizedDayRange, type DayCycle } from '@wildshard/engine/world/dayCycle';
import { SIM_API_VERSION } from '@wildshard/engine/sim/apiVersion';
import { createSimHost, type SimHost, type SimCommand, type SimHostPorts, type SimLevel, type SimStrike, type SimValue } from "@wildshard/engine/sim";
import { buildPlatformSpawns } from "@wildshard/engine/ai/platform";
import { addBakedTerrainCollider } from "@wildshard/engine/physics/terrainTiles";
import { decodeTerrainTile, terrainTileHeight, type TerrainTileData } from "@wildshard/format/terrainTileBytes";
import { fnv1a32 } from "@wildshard/engine/core/rng";
import { installScriptLane, type ScriptLanePort } from "@wildshard/engine/script/lane";
import { publishShardState, sayFightView } from '@wildshard/engine/sim/shardRows';
import type { EffectRules, ScriptEntity } from "@wildshard/engine/script/effects";
import { declaredWaterBody } from "@wildshard/engine/world/water/declared";
import { WaterBodies } from "@wildshard/engine/world/water/body";
import { floorBelow } from "@wildshard/engine/physics/query";
import { playerSeats } from './playerSeats';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { installDeclaredTalks } from '../shardfile/declaredTalks';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { installShardfileColliders, shardfileColliderIds } from "../../../shared/game/shardfile/collisionBindings";
import { validateMeshCollisionAssets } from "@wildshard/format/meshCollisionAssets";
import { validateMeshEntryways } from "@wildshard/format/meshEntryways";
import { clientGround } from "../../../shared/game/shardfile/clientGround";
import { declaredItemScriptEntities, type DeclaredItemPorts } from "../../../shared/game/shardfile/items";
import { syncTargetColliders } from "../../../shared/game/shardfile/targets";
import { scriptPhysicsQueries } from "@wildshard/engine/script/queries";
import { createQuestScriptPorts, DeclaredQuests, type QuestDataPorts, type QuestScriptBindings } from "../../../shared/game/quest/declared";
import { installDeclaredEncounters } from "../shard/declaredEncounters";
import type { Shardfile } from "@wildshard/format/shardSchema";
import { speciesResolver, simStrikes } from "./brain";
import { createShardfileScriptLane, verifiedScriptModules, type ScriptModuleAssets, type ShardScriptPorts } from "../shardfile/scripts";
import { installDeclaredBrains, type DeclaredBrainPorts } from "../shardfile/brainRuntime";
import { createShardfileComposedLane, type DeclaredScriptBrainPorts } from "../shardfile/scriptComposition";
import { bindPlayerColumns, dataCreaturePorts } from "../../../shared/game/shardfile/dataCreaturePorts";
import { prepareDeclaredGroupBrains, type DeclaredGroupPorts, type DeclaredGroupPolicy } from "../shardfile/groupRuntime";
import { prepareDeclaredCrowds, type DeclaredCrowdPorts, type PreparedCrowds } from "../../../shared/game/shardfile/crowdRuntime";
import { installLadders, type LadderClientPorts } from '../../../shared/game/shardfile/ladder';
import { MoverScriptDriver, playerGrounds, verifiedMoverModules, proveTerrainEntries, type TerrainEntryWalk, type DeclaredMoverComposition, type MoverRuntime } from "./mover";
import { socketLiftEntries } from "@wildshard/format/socketLiftAssets";
import { createClientChannels } from "../../../shared/game/plugin/channels";
import type { MoverPose } from "@wildshard/engine/physics/mover";
import { liftPrompt } from "../../../shared/game/shardfile/wirePrompts";
import { portalLinkEntries, portalLinkRules } from "@wildshard/format/portalLinkAssets";
import { validatePortalFloors } from "@wildshard/format/portalFloor";
import { portalTransitioning } from "../../../shared/game/shardfile/portalTraversal";
import { captureLiftRiders, parseLiftRiders, restoreLiftRider, type LiftRiders } from "../../../shared/game/shardfile/liftRider";
import * as v from "valibot";
import { installEntrySockets } from "@wildshard/engine/physics/entrySockets";
import { addPiece, type AddedPiece } from "@wildshard/engine/physics/pieces";
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';
import { scriptSeats, type ScriptSeats } from './scriptSeats';

type Physics = SimHost['physics'];
type PropColliderPort = NonNullable<ReturnType<ReturnType<typeof installShardfileColliders>['get']>>;
type PropColliderState = ReturnType<PropColliderPort['snapshot']>;

/** The most collider pieces one node bake may register. */
const MAX_BAKED_PIECES = 1024;
const BAKED_SURFACES = ['wood', 'metal', 'flesh', 'felt', 'stone', 'rock', 'sand', 'grass'] as const satisfies readonly Material[];
const bakedNumber = v.pipe(v.number(), v.finite());
const bakedPlaced = { x: bakedNumber, y: bakedNumber, z: bakedNumber, yaw: v.exactOptional(bakedNumber),
  rot: v.exactOptional(v.strictObject({ x: bakedNumber, y: bakedNumber, z: bakedNumber, w: bakedNumber })), surface: v.exactOptional(v.picklist(BAKED_SURFACES)) };
const BakedPieces = v.pipe(v.array(v.object({ id: v.string(), name: v.string(), file: v.string(), active: v.boolean(),
  category: v.exactOptional(v.picklist(['buildings', 'nature', 'props', 'ground'])), mode: v.exactOptional(v.literal('board')),
  surface: v.picklist(BAKED_SURFACES), owner: v.exactOptional(v.string()), colliders: v.array(v.union([
    v.strictObject({ kind: v.literal('box'), ...bakedPlaced, hx: bakedNumber, hy: bakedNumber, hz: bakedNumber }),
    v.strictObject({ kind: v.literal('hull'), ...bakedPlaced, points: v.array(bakedNumber) })])) })), v.maxLength(MAX_BAKED_PIECES));

/**
 * Register a Node bake's collider pieces (a `physics.baked.json`'s `pieces`, strictly parsed) with a native host's physics
 * in their baked order: every active piece, and the board-only ones (`mode: 'board'`), whose colliders return for
 * `SimHost.boardColliders`. A piece's colliders belong to its `owner`, else to the piece.
 */
export function addBakedPieces(physics: Physics, pieces: unknown): AddedPiece['colliders'] {
  const rows = v.parse(BakedPieces, pieces), board: AddedPiece['colliders'] = [];
  for (let i = 0; i < MAX_BAKED_PIECES; i++) {
    const piece = rows[i]; if (piece === undefined) break;
    if (!piece.active && piece.mode !== 'board') continue;
    const added = addPiece(physics, { id: piece.id, name: piece.name, category: piece.category ?? 'props', file: piece.file, surface: piece.surface,
      colliderOwner: piece.owner ?? piece.id, colliders: piece.colliders.map(c => c.kind === 'box' ? c : { ...c, points: new Float32Array(c.points) }) });
    if (piece.mode === 'board') board.push(...added.colliders);
  }
  return board;
}

/** The host's player strike where declared items own every damaging contact: a zero-damage probe. */
export const HOST_PROBE: Readonly<SimStrike> = { id: 'host.probe', shape: { kind: 'point', radius: 1 }, windup: 0.1, active: 0.1, recover: 0.2, cooldown: 0.3, range: 1, damage: 0, tags: [] };
/**
 * A trusted runtime's native level (SF72): the shard's identity, the player at the runtime's own stand and speed (capped
 * by the shard's author speed), no declared entities or quests (the runtime installs its own owners), and `HOST_PROBE`.
 */
export function trustedLevel(shard: Pick<Shardfile, 'identity' | 'authorCaps'>, player: SimLevel['player'], ground: SimLevel['ground']): SimLevel {
  return { version: SIM_API_VERSION, id: shard.identity.slug, seed: shard.identity.seed, ground,
    player: { at: player.at, yaw: player.yaw, speed: Math.min(player.speed, shard.authorCaps.speed) }, entities: [], quests: [], weapon: HOST_PROBE };
}
/** A cell's height for a body anywhere: a player on a road stands past its tile, and reads the tile's edge. Inside the tile this is the plain sample. */
export const tileHeightAt = (terrain: TerrainTileData) => (x: number, z: number): number => terrainTileHeight(terrain, x, z, { boundary: 'clamp' });

/** The shard's admitted terrain collider and its height query; a shard that declares none, or whose bytes are absent, refuses. */
export function admittedTerrain(shard: Pick<Shardfile, 'terrain'>, assets: ReadonlyMap<string, Uint8Array>): { readonly bytes: Uint8Array; readonly heightAt: (x: number, z: number) => number } {
  const bytes = shard.terrain === null ? undefined : assets.get(shard.terrain.collider);
  if (bytes === undefined) throw new Error('Missing admitted terrain collider');
  const terrain = decodeTerrainTile(bytes);
  return { bytes, heightAt: tileHeightAt(terrain) };
}
/**
 * Register a Node-baked world into a fresh trusted host (a restore brings it back with the physics): the admitted terrain
 * collider when given, then the baked pieces (`addBakedPieces`), whose board-only colliders join the host's board mode.
 */
export function addBakedWorld(host: SimHost, pieces: unknown, terrain?: Uint8Array): void {
  if (terrain !== undefined) addBakedTerrainCollider(host.physics, terrain, host.scope);
  const board = addBakedPieces(host.physics, pieces);
  if (board.length > 0) host.boardColliders(board);
}
interface RuntimeWorldRecipe {
  readonly population: { readonly rows: NativePopulationRows; readonly sources: 'actors' | 'actors+bosses'; readonly seed: 'identity' | 'declared'; readonly owner: unknown };
  readonly terrain: 'none' | 'collider'; readonly ground: SimLevel['ground'];
  readonly player: { readonly speed: number; readonly lift?: number; readonly at?: readonly [number, number, number]; readonly yaw?: number };
  readonly floor?: 'solids';
  readonly motion?: { readonly systemId: string; readonly skipPrefix?: string;
    readonly composition: Omit<DeclaredMoverComposition['content'], 'identity'>; readonly rules: ShardScriptPorts['rules'];
    readonly itemRole?: NonNullable<DeclaredMoverComposition['declarations']>[number]['row'];
    readonly permissions: readonly { readonly mover: string; readonly flags: readonly { readonly name: string; readonly bit: number }[] }[];
  };
}
/** Shared native world preparation: declarations select static collision, spawn and optional scripted motion on the same host. */
export async function prepareRuntimeWorld(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, baked: unknown, recipe: RuntimeWorldRecipe, sections: ReadonlyMap<string, unknown> = outputDescriptor(shard)?.sections ?? new Map()): Promise<{
  level: SimLevel; ports: { ground: false; heightAt: (x: number, z: number) => number };
  install: (host: SimHost, context: { restoring: boolean; emit: Parameters<typeof ledgerPorts>[0]; snapshot?: Parameters<ReturnType<typeof prepareNativePopulation>['install']>[2] }) => ReturnType<ReturnType<typeof prepareNativePopulation>['install']> & { ledger: ReturnType<typeof ledgerPorts>; hooks: ReturnType<ReturnType<typeof declaredItemScriptBindings>['hooks']>;
    hookTick: () => number; motion?: MoverRuntime; seats: ScriptSeats };
}> {
  const { pieces } = v.parse(v.object({ pieces: v.unknown() }), baked);
  const terrain = recipe.terrain === 'collider' ? admittedTerrain(shard, assets) : undefined;
  if (recipe.terrain === 'none' && shard.terrain !== null) throw new Error('Native world declares no terrain');
  const heightAt = terrain?.heightAt ?? (() => recipe.ground.height);
  const at = recipe.player.at;
  const player = { at: at === undefined ? { x: shard.spawn.x, y: heightAt(shard.spawn.x, shard.spawn.z) + (recipe.player.lift ?? 0), z: shard.spawn.z }
    : { x: at[0], y: at[1], z: at[2] }, yaw: recipe.player.yaw ?? shard.spawn.yaw, speed: recipe.player.speed };
  const row = recipe.motion, data = row === undefined ? [] : shard.movers.filter(value => row.skipPrefix === undefined || !value.id.startsWith(row.skipPrefix));
  const modules = row === undefined ? new Map<string, Uint8Array>() : new Map(await verifiedMoverModules(assets, data));
  if (row?.itemRole !== undefined) for (const [name, bytes] of await declaredItemScriptBindings(shard.items, 'actor.player').modules(assets)) modules.set(name, bytes);
  if (row !== undefined && (row.permissions.length > 64
    || row.permissions.some(value => !data.some(declaration => declaration.id === value.mover)))) throw new Error('Unbound native world motion rows');
  const policy = recipe.population;
  const actors = policy.sources === 'actors+bosses' ? (() => { const rows = readRuntimeWorldMetadata(baked, true); return [...rows.actors, ...rows.bosses]; })() : readRuntimeWorldMetadata(baked).actors;
  const population = prepareNativePopulation(policy.seed === 'identity' ? { ...policy.rows, seed: shard.identity.seed } : policy.rows, actors, policy.owner);
  return { level: trustedLevel(shard, player, recipe.ground), ports: { ground: false, heightAt }, install: (host, context) => {
  const seats = scriptSeats(host), { first } = seats;
    if(sections.has('actors/return-scripts')){
      const returns=serverReturnRows(sections.get('actors/return-scripts'));
      if(returns.some(candidate=>candidate.abi===2))ReturnProgram.lendModules(host.scope,assets,returns);
    }
    const restoring = context.restoring;
    if (!restoring) addBakedWorld(host, pieces, terrain?.bytes);
    if (recipe.floor === 'solids') host.setFloorQuery((x, z, fromY, maxDrop) => floorBelow(host.physics, x, z, fromY, maxDrop));
    const environment = (() => {
      if (row === undefined) return { hooks: new Map(), hookTick: () => -1, seats };
      const items = declaredItemScriptBindings(shard.items, first.id);
      const motion = new MoverScriptDriver(data, host).install(host, { content: { ...row.composition, identity: shard.identity }, rules: row.rules, assets: modules,
        declarations: row.itemRole === undefined ? [] : [{ row: row.itemRole, entities: items.entities, actors: items.actors }] },
      { id: row.systemId, restoring, restoreFlags: new Set(host.flags.all), drive: true, permissions: () => new Map(row.permissions.map(grant => [grant.mover, flagValue(host.flags, grant.flags)])) });
      routeLifts(host, shard, motion);
      if (shard.questHost?.observations.some(binding => binding.kind === 'mover' && binding.state === 'at-end')) host.onStep(`${row.systemId}.endpoints`, () => { motion.drainEndEvents(); });
      if (items.entities.length > 0 && motion.lane !== undefined) {
        seats.bind({ lane: motion.lane, items: shard.items, handle: numericScriptEntityId });
        host.onStep(`${row.systemId}.seats`, seats.step);
      }
      return { hooks: items.hooks(motion.scriptHost), hookTick: () => motion.scriptHost.currentTick, motion, seats };
    })();
    const ledger = ledgerPorts(context.emit);
    return { ...environment, ledger, ...population.install(host, ledger, context.snapshot, borrowedDecisionAuthority(shard, assets, sections, {
      scope: host.scope, events: host.events, flags: host.flags, get physics() { return host.physics; }, player: focusPlayer(host), groundHeightAt: host.groundHeightAt.bind(host),
      live: actor => host.entities.get(actor.entityId) === actor, fixed: (id, run, scope) => { scope.onDispose(host.onStep(id, run)); }, say: (name, args) => { sayFightView(host, name, args); },
    })) };
  } };
}
export interface NativeRuntimeRecipe extends RuntimeWorldRecipe {
  readonly runtime: {
    readonly weapon: { readonly id: string; readonly stowOnBoard?: boolean; readonly questWorld?: boolean; readonly worldReactionAction?: number };
    readonly quest: { readonly spots: 'metadata' | QuestGraphPorts['spots']; readonly crack?: boolean };
    readonly columns?: boolean;
    readonly entries?: TerrainEntryWalk;
  };
}
interface NativeRuntimeContext {
  readonly restoring: boolean; readonly snapshot?: Readonly<Omit<SimSnapshot, 'physics'>>;
  readonly emit: (effect: NativeRuntimeEffect) => void; readonly commands: () => readonly NativeMeleeInput[];
  /** Another player's commands this tick. */
  readonly playerCommands?: (id: string) => readonly NativeMeleeInput[];
}
/** Native quest facts, rewards and bounded player-facing contact hints publish only with a completed tick. */
export type NativeRuntimeEffect = Parameters<Parameters<typeof ledgerPorts>[0]>[0] | { readonly kind: 'hint'; readonly text: string };
interface NativeRuntimePlan {
  readonly level: SimLevel; readonly ports: Awaited<ReturnType<typeof prepareRuntimeWorld>>['ports'];
  readonly install: (host: SimHost, context: NativeRuntimeContext) => void;
  readonly proveEntries?: (host: SimHost) => ReturnType<typeof proveTerrainEntries>;
}
/** Complete declared native owners on the caller's one host, with original install phases and restore authority. */
export async function prepareRuntimePlan(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, baked: unknown, recipe: NativeRuntimeRecipe,
  sections: ReadonlyMap<string,unknown> = outputDescriptor(shard)?.sections ?? new Map()): Promise<NativeRuntimePlan> {
  const row = recipe.runtime, weapon = weaponRow(shard, row.weapon.id);
  const targets = sections.has('world/targets') ? parseWorldTargets(sections.get('world/targets')) : undefined;
  if (targets !== undefined) { const errors=worldTargetRules(targets,shard);if(errors.length>0)throw new Error(errors.join('; ')); }
  const ownsTargets = targets?.targets.some(target=>target.weapon===weapon.id) === true;
  const world = await prepareRuntimeWorld(shard, assets, baked, recipe, sections);
  const quest = shard.questHost;
  if (quest === undefined || quest === null) throw new Error('Missing admitted native quest host');
  const metadata = row.quest.spots === 'metadata' ? readRuntimeWorldMetadata(baked, true) : undefined;
  const spots = metadata?.spots ?? row.quest.spots;
  if (spots === 'metadata') throw new Error('Missing admitted native quest spots');
  const plan: NativeRuntimePlan = { level: world.level, ports: world.ports, install: (host, context) => {
    const environment = world.install(host, context), { ledger, keeper, encounter } = environment;
    const reactions = ownsTargets || row.weapon.worldReactionAction === undefined ? undefined : (() => {
      const page = quest.page;
      const declarations = page === undefined || 'version' in page ? undefined : page.world;
      if (declarations === undefined) throw new Error('Missing admitted quest world reactions');
      return bindQuestWorldReactions(declarations, { flags: host.flags });
    })();
    const loadout = bindNativeLoadout(host, { slots: [0], initial: 0, lower: 0, raise: 0 }, {
      owned: () => true, lockedFor: player => encounter.locked() || (row.weapon.stowOnBoard === true && player.board.on),
    });
    const playerCommands = context.playerCommands;
    const melee = installNativeMelee(host, weapon, weapon.native, { inputCommands: context.commands,
      enabled: () => loadout.live(0),
      ...(playerCommands === undefined ? {} : { others: { commands: player => playerCommands(player.id),
        enabled: player => !encounter.locked() && !(row.weapon.stowOnBoard === true && player.board.on),
        hook: player => environment.seats.hooks(player.id).get(weapon.id) ?? null } }),
      ...(row.weapon.questWorld ? { questWorld: { row: quest, spots } } : {}),
      hook: environment.hooks.get(weapon.id) ?? null, hookTick: environment.hookTick,
      ...(reactions === undefined ? {} : { landed: (action: number, from: Vector3, dir: Vector3) => { if (action === row.weapon.worldReactionAction) reactions.scan(from, dir); } }),
    });
    const questRuntime = installDeclaredQuestHost(host, shard, { ...ledger, spots,
      ...(row.quest.crack ? { crack: { reach: { light: weapon.light.range, heavy: weapon.heavy.range }, cracked: melee.cracked } } : {}),
      ...(metadata === undefined ? {} : { promptRegistrations: parsePromptRegistrations(metadata.promptRegistrations) }),
      commands: pickCommands(context.commands, command => {
        if (command.kind !== 'script') return undefined;
        if (command.actorId === undefined || command.value === undefined || !Number.isFinite(command.value)) throw new Error('Invalid admitted native script command');
        return { actorId: command.actorId, value: command.value, ...(command.playerId === undefined ? {} : { playerId: command.playerId }) };
      }), mechanics: { ...(environment.motion === undefined ? {} : { motion: environment.motion }),
        encounters: new Map([[parseBossOwnerRow(recipe.population.owner).actor, encounter]]) },
    });
    if (ownsTargets) bindNativeWorldTargets(host, melee, questRuntime, targets, context.emit);
    if (row.columns) bindPlayerColumns(host, shard.modes?.traverse ?? []);
    keeper.settle();
  } };
  const entries = row.entries;
  return entries === undefined ? plan : { ...plan, proveEntries: host => proveTerrainEntries(host.physics, shard.entryways, world.ports.heightAt, entries) };
}
/** Attach admitted contacts after the existing quest owner is installed, without a second melee or script clock. */
export function bindNativeWorldTargets(host: Pick<SimHost,'flags'>, melee: NativeMeleeOwner,
  quest: Pick<ReturnType<typeof installDeclaredQuestHost>,'rules'|'run'>, input: unknown, emit: (effect: Extract<NativeRuntimeEffect,{kind:'hint'}>)=>void): void {
  const contacts = new WorldTargetHost(input, {
    flags:{has:id=>quest.rules.has(id),set:id=>{host.flags.set(id);}},
    interactions:new Map(quest.rules.data.rows.map(row=>[row.id,{run:()=>quest.run(row.id).ok}])),
    hints:{show:text=>{emit({kind:'hint',text});}},
  });
  melee.family.bindWorldTargets(contacts);
}
/** A declared weapon row (`shard.items`) by id; an absent or non-weapon row refuses. */
export function weaponRow(shard: Pick<Shardfile, 'items'>, id: string): Extract<Shardfile['items']['rows'][number], { kind: 'weapon' }> {
  const row = shard.items.rows.find(item => item.id === id);
  if (row?.kind !== 'weapon') throw new Error(`Missing declared weapon ${id}`);
  return row;
}
/** The fact and coin ports every declared owner takes, emitted into a trusted runtime's tick effects. */
export function ledgerPorts(emit: (effect: { kind: 'fact'; name: string; actorId: string } | { kind: 'coins'; amount: number; actorId: string }) => void): {
  readonly fact: (name: string, actorId: string) => void; readonly coins: (amount: number, actorId: string) => void;
} {
  return { fact: (name, actorId) => { emit({ kind: 'fact', name, actorId }); }, coins: (amount, actorId) => { emit({ kind: 'coins', amount, actorId }); } };
}
/** The tick protocol's command allowance (sdk/tickProtocol.ts): one tick never carries more. */
const MAX_TICK_COMMANDS = 1024;
/** Metres past a prompt's radius a press still counts: the server has feet below the eye a page picks from, and a command behind it. */
const PROMPT_SLACK = 2.5;
/**
 * One owner's view of a trusted runtime's tick commands: each lent command in tape order through `pick` (undefined skips
 * it) into one reused list, so a step allocates no list; a tick past the protocol's allowance refuses.
 */
export function pickCommands<C, T>(commands: () => readonly C[], pick: (command: C) => T | undefined): () => readonly T[] {
  const out: T[] = [], overflow = new RangeError('Tick commands exceed the protocol allowance');
  return () => {
    out.length = 0;
    const list = commands(); if (list.length > MAX_TICK_COMMANDS) throw overflow;
    for (let i = 0; i < MAX_TICK_COMMANDS; i++) {
      const command = list[i]; if (command === undefined) break;
      const picked = pick(command); if (picked !== undefined) out.push(picked);
    }
    return out;
  };
}

const dayClockContinuation = v.strictObject({
  value: v.number(), paused: v.boolean(), scale: v.number(), cycle: v.number(),
  held: v.nullable(v.strictObject({ value: v.number(), paused: v.boolean() })),
  last: v.picklist(['dawn', 'day', 'golden', 'dusk', 'night']),
});

/** Positive stable actor handle; reordering spawns changes nothing. Hash collisions are refused during composition. */
export function numericScriptEntityId(id: string): number { return (fnv1a32(id) & 0x7fffffff) || 1; }
/** The existing client can lend its physics/player/fixed-step driver; Node owns them by default. */
export interface ShardfileSimPorts extends SimHostPorts {
  /** Hash/size-verified format-2 platform payloads; v1 never imports author source. */
  sections?: ReadonlyMap<string, unknown> | undefined;
  weapon?: SimStrike; quest?: QuestDataPorts; hooks?: QuestScriptBindings; scriptRules?: EffectRules;
  encounters?: Parameters<typeof installDeclaredEncounters>[2]; hud?: Parameters<typeof installDeclaredEncounters>[3];
  water?: WaterBodies; colliders?: ReadonlyMap<string, PropColliderPort>;
  /** Trusted native actor recipes; a declaration without its required family port refuses boot. */
  brains?: DeclaredBrainPorts;
  /** Embedded data hosts lend their real player impulse owner; Node uses its owned serialized impulse. */
  creatureImpulse?: (velocity: Vector3) => void;
  /** Trusted perception, prey/taming and body recipes for one controller per ordered pack/herd group. */
  groups?: DeclaredGroupPorts;
  /** Trusted terrain, observation and presentation recipes; every crowd is preflighted before setup. */
  crowds?: (host: SimHost) => DeclaredCrowdPorts;
  /** Trusted custom-policy observations and strike execution; aliases and actors belong to this factory. */
  scriptBrains?: (host: SimHost) => Pick<DeclaredScriptBrainPorts, 'ports'> & Partial<Pick<DeclaredScriptBrainPorts, 'query'>>;
  scriptEntities?: { entities: readonly ScriptEntity[]; actors: ReadonlyMap<number, string> };
  /** Tick-admitted numeric command values; the existing authoritative lane samples them once per fixed step. */
  commands?: () => ReadonlyMap<string, number>;
  query?: Parameters<typeof createShardfileScriptLane>[2]['query']; navigation?: Parameters<typeof scriptPhysicsQueries>[0]['navigation'];
  /** Borrowed client controls and mode registry; owned Node hosts consume admitted movement commands instead. */
  ladders?: LadderClientPorts;
  restoring?: boolean;
  /** The normal client or regional registry already owns its four platform sockets. */
  entrySocketsProvided?: boolean;
  /** Embedded pages lend their actual rendered look clock; the page alone advances it. */
  lookClock?: () => Pick<DayCycle, 'hour' | 'snapshot' | 'restore'>;
  /** G168: a declared module crossed its failure limit and stays off (the client tells the player; Node ignores it). */
  scriptDisabled?: ShardScriptPorts['onDisabled'];
}
/** Authoritative handles for UI, quests and the existing client fixed-step driver. */
export interface ShardfileSimulation {
  /** Actual page-order prompt selected from native eye position, distance and world LOS. */
  selectedInteraction: (player?: string) => string | null;
  /** Queue the selected authored scene only; absent, farther and occluded prompts refuse. `player` acts; the first player by default. */
  interact: (id: string, player?: string) => boolean;
  /** One player's item hooks, each acting as them. */
  itemHooks: ScriptSeats['hooks'];
  decisions?: ShardDecisions;
  host: SimHost; lane: ScriptLanePort | undefined; actors: ReadonlyMap<string, number>; quest: DeclaredQuests;
  encounters: ReturnType<typeof installDeclaredEncounters>; water: WaterBodies; colliders: ReadonlyMap<string, PropColliderPort>; dispose: () => void;
  groups: ReadonlyMap<string, DeclaredGroupPolicy>;
  crowds: PreparedCrowds['policies'];
  movers: MoverRuntime | undefined;
}
/** One declared simulation core, used by the normal browser loader and the headless author validator. */
function shardfileSimInput(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: ShardfileSimPorts): {level: SimLevel; ports: SimHostPorts} {
  if (shard.nativeGround !== null) throw new Error('Native ground retains its trusted runtime simulation; a flat declared proxy is forbidden');
  const portals = portalLinkEntries(shard.entryways), portalErrors = portalLinkRules(portals, shard);
  if (portalErrors.length > 0) throw new Error(portalErrors.join('; '));
  validatePortalFloors(portals, shard, assets);
  validateMeshCollisionAssets(shard, assets);
  validateMeshEntryways(shard, assets);
  const bytes = shard.terrain === null ? undefined : assets.get(shard.terrain.collider);
  if (shard.terrain !== null && bytes === undefined) throw new Error('Missing admitted terrain collider');
  const terrain = bytes === undefined ? undefined : decodeTerrainTile(bytes);
  const heightAt = shard.meshCollision === null ? terrain === undefined ? () => 0 : tileHeightAt(terrain)
    : clientGround(shard, assets).heightAt;
  const weapon = ports.weapon ?? HOST_PROBE;
  return {level: { version: SIM_API_VERSION, id: shard.identity.slug, seed: shard.identity.seed,
    ground: { size: 500, height: 0 }, player: { at: { x: shard.spawn.x, y: shard.spawn.y, z: shard.spawn.z }, yaw: shard.spawn.yaw, speed: Math.min(5, shard.authorCaps.speed) },
    entities: buildPlatformSpawns(shard.creatures.spawns, speciesResolver(shard.rows), simStrikes(shard.rows)), weapon, quests: [],
  }, ports: { ...ports, ground: ports.ground !== false && terrain === undefined && shard.meshCollision === null && shard.entryways.some(entry => (entry.kind ?? 'ground') === 'ground'), heightAt }};
}
/** Install the ordinary native simulation once. */
export function createShardfileSim(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: ShardfileSimPorts): ShardfileSimulation {
  const input = shardfileSimInput(shard, assets, ports);
  return bindShardfileSim(createSimHost(input.level, input.ports), shard, assets, ports);
}
/** Install once before deciding exact versus logical/fresh continuation from the complete native basis. */
export function prepareShardfileSimRestore(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: ShardfileSimPorts): PreparedSimHostRestore & {readonly simulation: ShardfileSimulation} {
  const input = shardfileSimInput(shard, assets, ports), target = prepareSimHostRestore(input.level, input.ports);
  try { return { ...target, simulation: bindShardfileSim(target.host, shard, assets, ports) }; }
  catch (error) { target.host.dispose(); throw error; }
}
/** Replace a private Object.entries snapshot value, preserving its tuple and
 * the downstream native observation validation rather than making a second pair. */
/** TE-ENG1: a decision's scene field writes the scene lane's public shared state; no lane, no port. */
function sceneFields(lane: ScriptLanePort | undefined): DecisionRuntime['scene'] {
  return lane === undefined ? undefined : { write: (field, value) => { lane.world.writePublicShared(field, value); } };
}
function observationValue(entry: [string, unknown], value: boolean): asserts entry is [string, boolean] { entry[1] = value; }

/** Reinstall matching adapters into a fresh standalone restore host; restoring skips collider allocation and stepping. */
export function bindShardfileSim(host: SimHost, shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: ShardfileSimPorts): ShardfileSimulation {
  const seats = scriptSeats(host), { first } = seats;
  // TE-ENG7: each declared body names its species on the wire. Set here, on create and on restore alike, and never in
  // the level's spec, so a save keeps its level fingerprint.
  for (const spawn of shard.creatures.spawns) { const body = host.entities.get(spawn.id); if (body !== undefined) body.species = spawn.species; }
  if (shard.nativeGround !== null) throw new Error('Native ground retains its trusted runtime simulation; a flat declared proxy is forbidden');
  const levelId = shard.identity.slug;
  if (host.level.id !== levelId || host.level.seed !== shard.identity.seed || host.entities.size !== shard.creatures.spawns.length || shard.creatures.spawns.some((row) => !host.entities.has(row.id))) throw new Error('Shardfile simulation host mismatch');
  try {
    installLadders(host, shard.modes?.traverse.filter(row => row.kind === 'ladder') ?? [], ports.ladders);
    const portals = portalLinkEntries(shard.entryways), portalErrors = portalLinkRules(portals, shard);
    if (portalErrors.length > 0) throw new Error(portalErrors.join('; '));
    validatePortalFloors(portals, shard, assets);
    validateMeshCollisionAssets(shard, assets);
    validateMeshEntryways(shard, assets);
    const bytes = shard.terrain === null ? undefined : assets.get(shard.terrain.collider);
    if (shard.terrain !== null && bytes === undefined) throw new Error('Missing admitted terrain collider');
    const terrain = bytes === undefined ? undefined : decodeTerrainTile(bytes);
    if (terrain !== undefined) host.setHeightQuery(tileHeightAt(terrain));
    if (!ports.restoring && bytes !== undefined) addBakedTerrainCollider(host.physics, bytes, host.scope);
    const liftEntries = socketLiftEntries(shard.entryways), resetMovers = new Set(liftEntries.flatMap(entry => [entry.lift.mover, entry.lift.gate]));
    if (liftEntries.length > 0 && !host.embedded && !ports.restoring && !ports.entrySocketsProvided) installEntrySockets(host.physics, host.scope, [{ x: 0, z: 0 }]);
    const water = ports.water ?? new WaterBodies();
    if (ports.water === undefined) for (const row of [...shard.water].sort((a, b) => Number(a.kind === 'sea') - Number(b.kind === 'sea'))) water.add(declaredWaterBody(row), host.scope);
    const ids = shardfileColliderIds(shard);
    if (portals.length > 0) {
      const safe = () => { if (portalTransitioning(host.physics)) throw new Error('Cannot step or snapshot during a portal transfer'); };
      host.onStep('portal.declared', safe, { snapshot: () => { safe(); return null; }, restore: value => {
        if (value !== null) throw new Error('Portal continuation cannot contain a mid-transfer state');
      } });
    }
    const colliders = ports.colliders ?? installShardfileColliders(shard, assets, () => host.physics, host.scope, ports.restoring);
    if (ids.length !== colliders.size || ids.some(id => !colliders.has(id))) throw new Error('Declared collider port mismatch');
    if (shard.meshCollision !== null) {
      // Layered native floors follow each creature's own height, never the top of an overhang above its head.
      host.setHeightQuery(clientGround(shard, assets).heightAt);
      host.setFloorQuery((x, z, fromY, maxDrop) => floorBelow(host.physics, x, z, fromY, maxDrop));
      for (const actor of host.entities.values()) actor.groundHeight = (x, z, fromY) => floorBelow(host.physics, x, z, fromY, 500) ?? -250;
    }
    let pendingColliders: ReadonlyMap<string, PropColliderState> | undefined;
    if (ids.length > 0) host.onStep('props.declared', () => undefined, {
      snapshot: () => Object.fromEntries([...colliders].map(([id, port]) => [id, { handles: port.snapshot().handles }])),
      restore: (value: SimValue) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== colliders.size) throw new Error('Invalid declared collider continuation');
        const states = new Map<string, PropColliderState>();
        for (const [id] of colliders) {
          const state = value[id];
          if (state === null || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state['handles']) || Object.keys(state).length !== 1) throw new Error('Invalid declared collider handles');
          const handles: number[] = [];
          for (const handle of state['handles']) {
            if (typeof handle !== 'number' || !Number.isFinite(handle) || handle < 0) throw new Error('Invalid declared collider handle');
            handles.push(handle);
          }
          states.set(id, { handles });
        }
        // The native snapshot replaces the constructor world after adapter.restore. Validate mesh geometry
        // and reconnect only after that replacement, against the actual saved world rather than its placeholder.
        if ((ports.restoring || isSimHostRestoring(host)) && shard.meshCollision !== null) pendingColliders = states;
        else for (const [id, state] of states) colliders.get(id)?.restore(state);
      },
      ...(shard.meshCollision !== null ? { physicsRestored: () => {
        if (pendingColliders === undefined) throw new Error('Missing declared mesh continuation');
        for (const [id, state] of pendingColliders) colliders.get(id)?.restore(state);
        pendingColliders = undefined;
      } } : {}),
    });
    const hooks = ports.hooks ?? shard.hooks;
    const actors = new Map<string, number>(), reverse = new Map<number, string>();
    for (const id of [first.id, ...host.entities.keys()]) {
      const handle = numericScriptEntityId(id); if (reverse.has(handle)) throw new Error('Script actor handle collision');
      actors.set(id, handle); reverse.set(handle, id);
    }
    const custom = new Map(shard.creatures.brains.filter((brain) => brain.kind === 'script').map((brain) => [brain.id, brain]));
    const brainBindings = shard.creatures.spawns.flatMap((spawn) => {
      const brain = spawn.brain === null ? undefined : custom.get(spawn.brain);
      return brain === undefined ? [] : [{ actorId: spawn.id, entity: numericScriptEntityId(`brain:${spawn.id}`), brain }];
    });
    if (brainBindings.length > 0 && ports.scriptBrains === undefined) throw new Error('Missing custom brain port');
    const dataPorts = shard.runtime === null ? dataCreaturePorts(host, shard.rows, shard.creatures.spawns, ports.creatureImpulse) : undefined;
    const groupIds = new Set(shard.creatures.groups.map((group) => group.id));
    const preparedGroups = prepareDeclaredGroupBrains(host, shard.creatures.groups, shard.creatures.spawns, ports.groups ?? dataPorts?.groups ?? {},
      shard.creatures.brains.map((brain) => brain.id), shard.encounters.map((row) => row.entity));
    if (shard.crowds.length > 0 && ports.crowds === undefined) throw new Error('Missing declared crowd ports');
    const preparedCrowds = prepareDeclaredCrowds(shard.crowds, ports.crowds?.(host) ?? { flock: () => { throw new Error('Missing declared crowd recipe'); } });
    let lane: ScriptLanePort | undefined;
    let movers: MoverRuntime | undefined;
    if (shard.sim.scripts.length > 0) {
      const entities = new Map<number, ScriptEntity>();
      for (const [id, handle] of actors) {
        const position = id === first.id ? first.position : host.entities.get(id)?.position;
        if (position === undefined) throw new Error('Missing host actor');
        entities.set(handle, { id: handle, name: id, position: [position.x, position.y, position.z], fields: {}, frozen: false, interactive: true });
      }
      const trusted = ports.scriptEntities ?? declaredItemScriptBindings(shard.items, first.id);
      for (const entity of trusted.entities) {
        if (entities.has(entity.id)) throw new Error('Duplicate trusted script entity'); entities.set(entity.id, entity);
      }
      for (const [handle, actor] of trusted.actors) {
        if (reverse.has(handle) || !entities.has(handle) || !actors.has(actor)) throw new Error('Invalid trusted owned-entity actor'); reverse.set(handle, actor);
      }
      for (const binding of shard.sim.bindings) {
        if (binding.actorId !== null) {
          if (reverse.get(binding.entity) !== binding.actorId) throw new Error('Script actor binding does not match host identity');
        } else if (!entities.has(binding.entity)) entities.set(binding.entity, { id: binding.entity, name: `director:${binding.entity}`, position: [0, 0, 0], fields: {}, frozen: false, interactive: true });
        else if (reverse.has(binding.entity)) throw new Error('Actor-free script cannot reuse an actor handle');
      }
      const aliases = new Set<number>();
      for (const binding of brainBindings) {
        if (entities.has(binding.entity) || aliases.has(binding.entity)) throw new Error('Custom brain alias collision');
        aliases.add(binding.entity);
      }
      for (const mover of shard.movers) {
        if (entities.has(mover.entity) || aliases.has(mover.entity)) throw new Error('Mover script alias collision');
        aliases.add(mover.entity);
      }
      if (entities.size + aliases.size > shard.serverBudget.entities) throw new Error('Aggregate script entity allowance');
      const options: ShardScriptPorts = {
        rules: ports.scriptRules ?? { fields: {}, archetypes: [], events: [...new Set([...hooks.scenes.map((scene) => scene.type), ...shard.items.rows.flatMap((row) => row.hook === null ? [] : [row.hook.event])])], maxEntities: shard.serverBudget.entities },
        entities: [...entities.values()], actors: reverse, seatsFor: first.id,
        ...(ports.scriptDisabled === undefined ? {} : { onDisabled: ports.scriptDisabled }),
        query: ports.query ?? ((kind, input, entity) => scriptPhysicsQueries({ physics: host.physics, navigation: ports.navigation ?? { closestWalkable: () => null, findPath: () => null }, handle: (owner) => typeof owner === 'string' ? actors.get(owner) : undefined })(kind, input, entity)),
      };
      const moverDriver = shard.movers.length === 0 ? undefined : new MoverScriptDriver(shard.movers, options.query, [...resetMovers]);
      if (brainBindings.length > 0) {
        if (ports.scriptBrains === undefined) throw new Error('Missing custom brain port');
        const trustedBrains = ports.scriptBrains(host);
        if (typeof trustedBrains.ports.observe !== 'function' || typeof trustedBrains.ports.mayAttack !== 'function' || typeof trustedBrains.ports.strike !== 'function') throw new Error('Missing custom brain observation or strike recipe');
        const brainPorts = { ...trustedBrains, query: trustedBrains.query ?? options.query, actors: host.entities, bindings: brainBindings };
        lane = moverDriver === undefined ? createShardfileComposedLane(shard, assets, options, brainPorts) : moverDriver.compose(shard, assets, options, brainPorts);
      } else lane = moverDriver === undefined ? createShardfileScriptLane(shard, assets, options) : moverDriver.compose(shard, assets, options);
      if (moverDriver !== undefined) {
        const stateWorld = lane.world;
        const runtime = moverDriver.install(host, lane, { id: 'movers.declared', restoreFlags: new Set(host.flags.all),
          activation: { ground: () => playerGrounds(host), shared: id => {
            const field = shard.state.shared.find(row => row.id === id);
            const value = field === undefined ? undefined : stateWorld.publicField(field.name);
            return typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
          } }, ...(ports.restoring === undefined ? {} : { restoring: ports.restoring }) });
        movers = runtime;
        if (!host.embedded) routeLifts(host, shard, runtime);
      }
      seats.bind({ lane, items: shard.items, actors, handle: numericScriptEntityId });
      if (!host.embedded) host.onStep('script.seats', seats.step);
      installScriptLane(host, 'script.declared', lane, ports.commands);
      const stateLane = lane;
      if (shard.state.shared.some(field => field.privacy === 'public')) publishShardState(host, () => stateLane.world.publicShared());
    }
    if (shard.targets.panels.length > 0) {
      const targetLane = lane; if (targetLane === undefined) throw new Error('Target fields require an installed script lane');
      const sync = () => syncTargetColliders(shard.targets, colliders, (scope, id) => {
        const field = shard.state[scope].find((row) => row.id === id);
        if (field === undefined) throw new Error('Missing target state field');
        // One collider stands for everyone, so a player-scoped panel keeps the first player's view (shipped panels are shared).
        const value = scope === 'shared' ? targetLane.world.publicField(field.name) : targetLane.world.viewField(first.id, scope, field.name);
        if (value === undefined) throw new Error('Unavailable target state field');
        return value;
      });
      host.onStep('targets.declared', sync); if (!ports.restoring) sync();
    }
    if (liftEntries.length > 0) {
      let rider: LiftRiders = null;
      host.onStep('lift.rider', () => undefined, { snapshot: () => captureLiftRiders(shard, { host, movers }),
        restore: value => { rider = parseLiftRiders(value); },
        physicsRestored: () => { restoreLiftRider(shard, { host, movers, water }, rider); },
      });
    }
    const quest = new DeclaredQuests(host, shard.quests, { ...ports.quest,
      ...(lane === undefined ? {} : { script: createQuestScriptPorts(lane, hooks, actors) }),
    });
    installDeclaredTalks(host, shard, quest); // TE-ENG3: a no-code quest-giver's answers and each player's node
    const needsDay = (shard.directors ?? []).some(data => Object.values(data.inputs).some(binding => directorDayRange(binding) !== null));
    let day: (() => number) | undefined;
    if (needsDay) {
      if (host.embedded) {
        const clock = ports.lookClock;
        if (clock === undefined) throw new Error('Day director requires the page-owned look clock');
        day = () => clock().hour;
        host.onStep('director.day', () => undefined, { snapshot: () => JSON.stringify(clock().snapshot()), restore: value => {
          if (typeof value !== 'string') throw new Error('Invalid director day continuation');
          clock().restore(v.parse(dayClockContinuation, JSON.parse(value)));
        } });
      } else {
        const clock = host.useDayClock(normalizedDayClock(shard.look.day ?? DEFAULT_NORMALIZED_DAY, shard.look.dayOverride));
        day = () => clock.hour;
      }
    }
    for (const data of shard.directors ?? []) {
      const bindingIssues = directorDataHostIssues(data);
      if (bindingIssues.length > 0) throw new Error(`Director rows require native bindings for their observations and actions: ${bindingIssues.join('; ')}`);
      if (Object.values(data.inputs).some(binding => binding.startsWith('flag:') && !shard.quests.flags.includes(binding.slice(5)))
        || data.stages.some(stage => stage.do.some(action => 'flag' in action && !shard.quests.flags.includes(action.flag.key)))) throw new Error('Director flag has no declared native owner');
      const director = new DirectorStageLane(data);
      // Cache only bounded immutable binding decodes, not observations or hosts.
      // Each tick still snapshots the current source entries before any reads.
      const bindings = new Map<string, { range: ReturnType<typeof directorDayRange>; flag: string }>();
      const observeInput = (entry: [string, string]): [string, boolean] => {
        const binding = entry[1];
        let plan = bindings.get(binding);
        if (plan === undefined) {
          const range = directorDayRange(binding);
          plan = { range, flag: range === null ? binding.slice(5) : '' };
          if (typeof binding === 'string' && bindings.size < 16) bindings.set(binding, plan);
        }
        let value: boolean;
        if (plan.range === null) value = host.flags.has(plan.flag);
        else {
          if (day === undefined) throw new Error('Missing director day clock');
          value = inNormalizedDayRange(day(), plan.range[0], plan.range[1]);
        }
        const result: [string, unknown] = entry;
        observationValue(result, value);
        return result;
      };
      host.onStep(`director.${data.id}`, (_dt, native) => {
        const observation = Object.fromEntries(Object.entries(data.inputs).map(observeInput));
        for (const action of director.step(native.state.tick, observation)) {
          if (!('flag' in action)) throw new Error('Director action has no native owner');
          native.flags.set(action.flag.key, action.flag.value);
        }
      }, { snapshot: () => director.snapshot(), restore: state => {
        if (typeof state !== 'string') throw new Error('Invalid director row continuation'); director.restore(state);
      } });
    }
    installDeclaredBrains(host, shard.creatures.spawns.filter((spawn) => spawn.brain === null || (!custom.has(spawn.brain) && !groupIds.has(spawn.brain))), shard.creatures.brains.filter((brain) => brain.kind !== 'script'), ports.brains ?? dataPorts?.brains);
    dataPorts?.install();
    const decisionRows = decisionScriptsFromSections(ports.sections);
    const decisionActors = new Set(decisionRows.flatMap(row => Object.values(row.actors)));
    const decisionEncounters = new Set(shard.encounters.filter(row => decisionActors.has(row.entity)).map(row => row.id));
    const encounters = installDeclaredEncounters(host, shard.encounters, ports.encounters ?? (() => ({ saved: { defeated: false, rewardTaken: false, kills: 0 }, persist: () => undefined, reward: () => undefined })), ports.hud, decisionEncounters);
    const decisions = decisionRows.length === 0 ? undefined : new ShardDecisions(decisionRuntime(host, sceneFields(lane)), shard, assets, ports.sections ?? new Map(), encounters, quest, movers, ports.quest?.fact, ports.restoring ?? false, ports.navigation, ports.scriptDisabled);
    // All individual/custom aliases and encounter recipes have admitted successfully before setup draws or group work.
    const groups = preparedGroups.install(ports.restoring ?? false);
    if (!host.embedded && !ports.restoring) host.physics.step();
    // Crowd setup is last: all scripts, actor/group controllers, quests, encounters and physics have admitted.
    const crowds = preparedCrowds.install(host, ports.restoring ?? false);
    const picker = createHeadlessPromptPicker(host);
    const prompts = shard.targets.interactions.map((row, act) => ({ act, id: row.id, position: { x: row.at[0], y: row.at[1], z: row.at[2] }, radius: row.radius }));
    const selectedInteraction = (player: string = first.id): string | null => {
      const body = host.players.get(player);
      return body === undefined ? null : picker.pick(prompts, body.position)?.id ?? null;
    };
    const interact = (id: string, player: string = first.id): boolean => {
      const row = shard.targets.interactions.find(target => target.id === id);
      if (row === undefined) throw new Error('Unknown authored interaction');
      if (selectedInteraction(player) !== id) return false;
      if (decisions?.interact(id) === true) return true;
      if (lane === undefined) throw new Error('Interaction requires an admitted scene lane');
      seats.step(); createQuestScriptPorts(lane, hooks, actors).scene(row.scene, player); return true;
    };
    return { selectedInteraction, interact, itemHooks: seats.hooks, ...(decisions === undefined ? {} : { decisions }), host, lane, actors, quest, encounters, water, colliders, groups, crowds, movers, dispose: () => { host.dispose(); } };
  } catch (error) { host.dispose(); throw error; }
}

/** The normal interaction queues these commands on both the deck and its road gate. No author callback is invoked. */
export function commandSocketLift(runtime: MoverRuntime, lift: SocketLift, action: 1 | 2 | 3): void {
  runtime.command(lift.mover, action); runtime.command(lift.gate, action);
}

/** One lift prompt as its row declares it: where it stands for a deck's pose, and when it stands nowhere at all. */
interface LiftPromptSpot { readonly radius: number; readonly at: (pose: MoverPose) => { readonly x: number; readonly y: number; readonly z: number } | null }
function liftPromptSpots(shard: Pick<Shardfile, 'clientChannels'>): Map<string, LiftPromptSpot> {
  const spots = new Map<string, LiftPromptSpot>();
  for (const program of shard.clientChannels ?? []) {
    const { prompt } = program;
    if (prompt?.action.kind !== 'socketLift') continue;
    const lane = createClientChannels(program), axes = lane.reads.map(read => /^position\.([xyz])$/u.exec(read)?.[1]);
    if (axes.some(axis => axis !== 'x' && axis !== 'y' && axis !== 'z')) throw new Error('A lift prompt reads its deck\'s position only');
    spots.set(`${prompt.action.edge}:${String(prompt.action.action)}`, { radius: prompt.radius, at: pose => {
      lane.evaluate({ time: 0, delta: 0, values: axes.map(axis => axis === 'x' ? pose.position.x : axis === 'y' ? pose.position.y : pose.position.z) });
      const { x, y, z } = lane.frame;
      return x === undefined || y === undefined || z === undefined ? null : { x, y, z };
    } });
  }
  return spots;
}
/** A client calls a lift by name, and the prompt's own row says from where: within its radius of where it stands now, so a deck under way takes no call. */
function routeLifts(host: SimHost, shard: Pick<Shardfile, 'entryways' | 'clientChannels'>, runtime: MoverRuntime): void {
  const routes = actRoutes(host), spots = liftPromptSpots(shard);
  for (const { edge, lift } of socketLiftEntries(shard.entryways)) for (const action of [1, 2, 3] as const) routes.claims.set(liftPrompt(lift.mover, action), player => {
    const spot = spots.get(`${edge}:${String(action)}`), body = host.players.get(player)?.position, at = spot?.at(runtime.pose(lift.mover)) ?? null;
    if (spot !== undefined && body !== undefined && at !== null && Math.hypot(body.x - at.x, body.y - at.y, body.z - at.z) < spot.radius + PROMPT_SLACK) commandSocketLift(runtime, lift, action);
    else routes.refused++;
  });
}

/** Native host evidence for the author-only grid and ledger workflow. */
export interface AuthoredGridProof {
  version: 1; ticks: number; checkpointTick: number;
  grid: { reserveBeforePhysics: true; runtimeFence: true; refusedSave: true; restored: true; frozenTicks: 5; loads: 2; leasesAfterDispose: 0 };
  ledger: { facts: { name: string; actorId: string; tick: number }[]; granted: number; durableReload: true; duplicateStable: true };
}
/** Fixed native author workflow: real grid residency, checkpoint refusal/restore and quest-owned Ledger filing.
 * The SDK supplies admitted commands, never facts, owner identities, reward catalogue entries or host modules.
 * Profile storage is a serialized SaveStore test port; this proves the atomic contract, not browser quota availability.
 */
export async function proveAuthoredGrid(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: ShardfileSimPorts,
  plan: { ticks: number; checkpointTick: number; requiredFacts: readonly string[] },
  inputAt: (tick: number, sim: ShardfileSimulation) => SimCommand | undefined): Promise<AuthoredGridProof> {
  if (source.runtime !== null || !Number.isInteger(plan.ticks) || plan.ticks < 1 || plan.ticks > 4096
    || !Number.isInteger(plan.checkpointTick) || plan.checkpointTick < 1 || plan.checkpointTick > plan.ticks) throw new Error('Invalid author proof');
  const insist = (ok: boolean, message: string): void => { if (!ok) throw new Error(`Author proof: ${message}`); };
  const instance = 'author-4', allocator = new ResidencyAllocator();
  const assembly = new GridAssembly({ developer: false, devserver: false }, {
    version: 0, pitch: CONTENT_CAPS.pitch, cells: Array.from({ length: 9 }, (_, index) => ({ instance: `author-${index}`, slug: source.identity.slug, cell: [index % 3 - 1, Math.floor(index / 3) - 1] })),
    emptyNeighbour: { kind: 'sea', level: 0, edgeColour: [0.5, 0.5, 0.5], fog: { colour: [0.5, 0.5, 0.5], near: 10, far: 1000 } },
  });
  interface Fact { name: string; actorId: string; tick: number }
  const facts: Fact[] = [], baselineFacts: Fact[] = [];
  const make = (record: Fact[], saved?: SimSnapshot): ShardfileSimulation => {
    let current: ShardfileSimulation | undefined;
    const native = { ...ports, quest: { fact: (name: string, actorId: string) => {
      if (current === undefined) throw new Error('Fact emitted outside an installed native tick');
      record.push({ name, actorId, tick: current.host.state.tick });
    }, coins: () => undefined } };
    current = createShardfileSim(source, assets, native);
    if (saved !== undefined) {
      const level = current.host.level; current.dispose(); current = undefined;
      const installed: { value?: ShardfileSimulation } = {};
      const host = restoreSimHost(level, { rapier: ports.rapier }, saved, fresh => { installed.value = bindShardfileSim(fresh, source, assets, { ...native, restoring: true }); });
      current = installed.value;
      if (current === undefined) { host.dispose(); throw new Error('Missing restored author owner'); }
    }
    return current;
  };
  const highway = make([]), baseline = make(baselineFacts);
  let resident: ShardfileSimulation | undefined, admitted = false, durable = false, loads = 0;
  const saved = new Map<string, SimSnapshot>();
  const grid = new GridSimulation(assembly, { highway, allocator, residentBytes: () => source.budgets.sim.resident,
    admitted: () => admitted, read: id => saved.get(id), save: (id, value) => { if (!durable) return false; saved.set(id, structuredClone(value)); return true; },
    load: (_cell, snapshot) => { insist(allocator.has(`sim:${instance}`), 'physics allocated before reservation'); loads++; resident = make(facts, snapshot); return Promise.resolve(resident); },
  });
  try {
    insist(!grid.ready(instance), 'unloaded cell is ready'); await grid.prefetch([instance]);
    insist(!grid.ready(instance), 'physics bypassed runtime admission'); admitted = true;
    insist(grid.ready(instance), 'admitted cell is unavailable'); (await grid.prepare(null, instance)).commit();
    if (resident === undefined) throw new Error('Missing author residency');
    const healthy = (value: ShardfileSimulation): void => {
      insist(!value.lane?.host.checkpoint().modules.some(module => module.failures > 0 || module.disabled), 'script failed');
      insist([...value.host.players.values(), ...value.host.entities.values()].map(body => body.position).every(point => [point.x, point.y, point.z].every(Number.isFinite)), 'nonfinite native pose');
    };
    for (let tick = 0; tick < plan.checkpointTick; tick++) { grid.step(inputAt(tick, resident)); healthy(resident); }
    insist(!grid.checkpoint(instance), 'failed durable save admitted'); durable = true;
    insist(grid.checkpoint(instance), 'durable checkpoint refused');
    insist(loads === 1, 'first residency loaded more than once');
    const continuation = regionalContinuation(resident.host), player = leadSnapshot(snapshotSimHost(resident.host));
    const tick = resident.host.state.tick;
    (await grid.prepare(instance, null)).commit(); for (let i = 0; i < 5; i++) grid.step();
    insist(resident.host.state.tick === tick, 'inactive region advanced');
    insist(grid.unload(instance) && !allocator.has(`sim:${instance}`), 'unload retained physics lease');
    (await grid.prepare(null, instance)).commit();
    insist(regionalContinuation(resident.host) === continuation, 'regional continuation changed on restore');
    insist(loads === 2, 'restore did not create a fresh residency');
    const restoredPlayer = leadSnapshot(snapshotSimHost(resident.host));
    insist(JSON.stringify(restoredPlayer.position) === JSON.stringify(player.position) && restoredPlayer.yaw === player.yaw, 'traveler pose changed on restore');
    for (let next = plan.checkpointTick; next < plan.ticks; next++) { grid.step(inputAt(next, resident)); healthy(resident); }
    for (let next = 0; next < plan.ticks; next++) { baseline.host.step(leadCommands(baseline.host, inputAt(next, baseline))); healthy(baseline); }
    insist(regionalContinuation(resident.host) === regionalContinuation(baseline.host), 'restored regional suffix diverged');
    insist(JSON.stringify(facts) === JSON.stringify(baselineFacts), 'restored facts diverged or repeated');
    const values = new Map<string, string>();
    const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const ledger = () => new Ledger(new SaveStore({ local: storage, session: null }), [{ id: instance, shard: source.identity.slug }],
      [{ shard: source.identity.slug, revision: source.identity.revision, rules: source.ledger }], []);
    const owner = ledger(); let granted = 0;
    const filed = facts.map((fact, ordinal) => {
      const quest = source.quests.quests.find(row => row.id === fact.actorId && row.onComplete?.fact === fact.name);
      if (quest === undefined) throw new Error('Missing native quest fact provenance');
      return { instance, shard: source.identity.slug, revision: source.identity.revision, entity: fact.actorId, tick: fact.tick, ordinal,
        name: fact.name, origin: { kind: 'engine' as const, source: `quest:${quest.id}` } };
    });
    for (const fact of filed) { const receipt = owner.record(fact); insist(receipt.status !== 'pending', 'ledger write pending'); if (receipt.status === 'granted') granted++; }
    for (const name of plan.requiredFacts) insist(filed.some(fact => fact.name === name), `native fact missing: ${name}`);
    const state = JSON.stringify(owner.state()), reloaded = ledger();
    insist(JSON.stringify(reloaded.state()) === state, 'serialized profile reload diverged');
    for (const fact of filed) insist(reloaded.record(fact).status === 'duplicate', 'ledger replay duplicated reward');
    insist(JSON.stringify(reloaded.state()) === state, 'duplicate filing changed profile');
    return { version: 1 as const, ticks: plan.ticks, checkpointTick: plan.checkpointTick,
      grid: { reserveBeforePhysics: true as const, runtimeFence: true as const, refusedSave: true as const, restored: true as const, frozenTicks: 5 as const, loads: 2 as const, leasesAfterDispose: 0 as const },
      ledger: { facts, granted, durableReload: true as const, duplicateStable: true as const } };
  } finally {
    baseline.dispose(); grid.dispose();
    insist(allocator.entries().length === 0, 'residency leak after disposal');
  }
}

/** Native/page owners inject their existing actor and contact ports; binding never advances a clock or aim. */
export interface MeleeContactPorts<T extends ContactScanTarget> extends ContactFamilyPorts<T> { readonly owner: Parameters<ContactFamilyPorts<T>['hit']>[0]['source'] }
/** Admit ordered numeric contacts and bind one existing shared controller, preserving source and event ownership. */
export function bindMeleeContacts<T extends ContactScanTarget>(weaponId: string, rows: unknown, ports: MeleeContactPorts<T>): ContactFamily<T> {
  if (!/^weapon\.[a-z][a-zA-Z0-9.-]*$/u.test(weaponId) || weaponId.length > 128) throw new Error('Bound melee weapon identity required');
  const admitted = parseMeleeContacts(rows);
  return new ContactFamily(admitted.map(row => ({ lane: row.lane, heavy: row.heavy, cooldown: row.cooldown,
    shape: row.shape, reach: row.reach, size: row.size, height: row.height, allowance: row.allowance,
    lands: row.lands, show: row.show, reports: row.reports, hits: row.hits.map(hit => ({
    tags: hit.tags, weaponId, source: hit.source === 'owner' ? ports.owner : 'env',
    damage: hit.damage, moveId: hit.moveId, copyVectors: hit.copyVectors, copyTags: hit.copyTags, reactions: hit.reactions,
  })) })), ports);
}


/** One admitted secondary action selects its declared move; script memory belongs to the existing item ScriptHost. */
export interface MeleeSecondaryInput { readonly tick: number; readonly dt: number; readonly action: 3 | 4; readonly move: number }
/** Start a row only after its actor-bound AS item hook accepts it. Contacts remain in the owner's original phase. */
export function startMeleeSecondary<T extends ContactScanTarget>(family: ContactFamily<T>, hook: ReturnType<DeclaredItemPorts['runtime']>['hook'], input: MeleeSecondaryInput): number | null {
  const row = family.moves[input.move];
  if (hook === null || family.secondaryCooldown > 0 || row?.lane !== 'secondary'
    || !Number.isSafeInteger(input.tick) || input.tick < 0 || !Number.isFinite(input.dt) || input.dt < 0 || input.dt > 1
    || ![3, 4].includes(input.action) || !Number.isInteger(input.move) || input.move < 0 || input.move > 15) return null;
  if (hook({ tick: input.tick, dt: input.dt, action: input.action, fuel: 0, cooldown: family.secondaryCooldown }) !== input.action) return null;
  return (row.lands.length === 0 ? family.claim(input.move) : family.swing(input.move)) ? input.move : null;
}

/** Shared item aliases and action hooks. Verified modules join the caller's existing lane. */
export function declaredItemScriptBindings(input: unknown, actorId: string): ReturnType<typeof declaredItemScriptEntities> & { modules: (assets: ScriptModuleAssets) => Promise<ReadonlyMap<string, Uint8Array>>; hooks: (host: Parameters<typeof scriptItemHook>[0]) => ReadonlyMap<string, ReturnType<typeof scriptItemHook>> } {
  const items = parseItems(input), aliases = declaredItemScriptEntities(items, actorId);
  const refs = items.rows.flatMap(row => row.hook === null ? [] : [row.hook.module]);
  return { ...aliases, modules: (assets: ScriptModuleAssets): Promise<ReadonlyMap<string, Uint8Array>> => verifiedScriptModules(assets, refs),
    hooks: (host: Parameters<typeof scriptItemHook>[0]): ReadonlyMap<string, ReturnType<typeof scriptItemHook>> => new Map(items.rows.flatMap(row => row.hook === null ? []
      : [[row.id, scriptItemHook(host, row.hook.module, row.hook.entity, row.hook.event, actorId)] as const])),
  };
}

type NativeMeleeTarget = ReturnType<SimHost['combat']['targetPort']>;
type NativeMeleeHook = NonNullable<ReturnType<DeclaredItemPorts['runtime']>['hook']>;
type NativeMeleeContact = ReturnType<typeof parseMeleeContacts>[number];

/** One native move or the tick's aim input; commands remain in the owner's authoritative order. `free` is a move that names
 *  nothing (P1-E3.2): the look pitch it leaves along, the contact shape finding what it meets. */
export type NativeMeleeCommand = { readonly kind: 'aim'; readonly pitch: number }
  | { readonly kind: 'move'; readonly action: number; readonly targetId?: string; readonly world?: number; readonly free?: number };
/** A world contact's admitted outcome: a light crack answers its first contact, a heavy crack its second. */
export interface NativeMeleeWorld { readonly act: number; readonly at: Readonly<{ x: number; y: number; z: number }>;
  readonly radius: number; readonly crack: 'light' | 'heavy' }
/** Original posed head ball and body capsule in world metres. */
export interface NativeMeleeVolumes { readonly head: Vector3; readonly headRadius: number;
  readonly a: Vector3; readonly b: Vector3; readonly bodyRadius: number }
const nativeMeleeOc = new Vector3(), nativeMeleeBa = new Vector3(), nativeMeleeOa = new Vector3(), nativeMeleeClosest = new Vector3();

function nativeMeleeBall(from: Vector3, dir: Vector3, centre: Vector3, radius: number): number | null {
  const oc = nativeMeleeOc.subVectors(from, centre), b = oc.dot(dir), c = oc.lengthSq() - radius * radius, h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h); return t >= 0 ? t : null;
}
/** Exact posed-volume ray query, including an immediate solid hit when the origin lies inside a volume. */
export function nativeMeleeVolumeHit(from: Vector3, dir: Vector3, reach: number, body: NativeMeleeVolumes): number | null {
  const ba = nativeMeleeBa.subVectors(body.b, body.a), oa = nativeMeleeOa.subVectors(from, body.a);
  const baba = ba.lengthSq(), along = baba > 1e-12 ? Math.min(1, Math.max(0, oa.dot(ba) / baba)) : 0;
  const closest = nativeMeleeClosest.copy(body.a).addScaledVector(ba, along);
  if (from.distanceToSquared(closest) <= body.bodyRadius ** 2 || from.distanceToSquared(body.head) <= body.headRadius ** 2) return 0;
  let best = Infinity;
  const bard = ba.dot(dir), baoa = ba.dot(oa), rdoa = dir.dot(oa), a = baba - bard * bard;
  if (a > 1e-12) {
    const b = baba * rdoa - baoa * bard, c = baba * oa.lengthSq() - baoa * baoa - body.bodyRadius ** 2 * baba, h = b * b - a * c;
    if (h >= 0) { const t = (-b - Math.sqrt(h)) / a, y = baoa + t * bard; if (t >= 0 && y > 0 && y < baba) best = t; }
  }
  for (const t of [nativeMeleeBall(from, dir, body.a, body.bodyRadius), nativeMeleeBall(from, dir, body.b, body.bodyRadius), nativeMeleeBall(from, dir, body.head, body.headRadius)]) if (t !== null && t < best) best = t;
  return best <= reach ? best : null;
}
/** Minimal admitted input view; other commands keep their original routes. */
export interface NativeHeldCommand { readonly kind:string; readonly heavy?: { readonly targetId?:string|undefined }|undefined; readonly swing?: boolean|undefined; readonly secondary?: boolean|undefined; readonly pitch?: number|undefined }
/** Admitted page/script fields consumed by the declared native command mapping. */
export interface NativeMeleeInput extends NativeHeldCommand {
  readonly attack?: {readonly targetId?:string|undefined}|undefined; readonly actorId?:string|undefined; readonly value?:number|undefined; readonly playerId?:string|undefined;
  readonly swing?:true|undefined; readonly pitch?:number|undefined; readonly seq?:number|undefined;
}
/** Runtime authority and command ports are injected; no imported module installs a host. */
export interface NativeMeleePorts {
  readonly commands?: () => readonly NativeMeleeCommand[];
  readonly inputCommands?: () => readonly NativeMeleeInput[]; readonly worldActor?: string;
  /** Full admitted player input; sampled once when the owner declares held release. */
  readonly heldCommands?: () => readonly NativeHeldCommand[]; readonly enabled?: () => boolean;
  /** Every other player's input and stowed state; absent, only the first player holds this weapon. */
  readonly others?: { readonly commands: (player: PlayerSim) => readonly NativeMeleeInput[]; readonly enabled: (player: PlayerSim) => boolean;
    /** Their own actor-bound hook for this item, when it has one. */ readonly hook?: (player: PlayerSim) => NativeMeleeHook | null };
  readonly world?: readonly NativeMeleeWorld[];
  readonly questWorld?:{readonly row:QuestHostRow;readonly spots:QuestGraphPorts['spots']};
  readonly hook?: NativeMeleeHook | null;
  /** The existing composed ScriptHost's current tick; never starts a second script clock. */
  readonly hookTick?: () => number;
  readonly landed?: (action: number, from: Vector3, dir: Vector3) => void;
}
/** The shared controller and the current tick's world outcome. */
export interface NativeMeleeOwner { readonly family: ContactFamily<NativeMeleeTarget>; readonly cracked: (player: string) => number | null }
const NativeHoldState = v.strictObject({version:v.literal(1),held:v.pipe(v.number(),v.finite(),v.minValue(0)),wasHeld:v.boolean(),
  target:v.nullable(v.pipe(v.string(),v.minLength(1),v.maxLength(128)))});
/** Install immediate and delayed item contacts on one renderer-free owner, retaining ordered commands and wire bindings. */
export function installNativeMelee(host: SimHost, weapon: { readonly id: string; readonly contacts?: readonly NativeMeleeContact[] },
  input: unknown, given: NativeMeleePorts): NativeMeleeOwner {
  const { native: row, contacts } = parseNativeMeleeBinding(input, weapon.contacts);
  if(row.held!==undefined&&given.heldCommands===undefined&&given.inputCommands===undefined)throw new Error('Held input requires its admitted player stream');
  if(row.input===undefined?given.commands===undefined:given.inputCommands===undefined)throw new Error('Native melee requires its declared command stream');
  const questWorld=given.questWorld,worldActor=given.worldActor??questWorld?.row.graph.actor;
  const firstTargets=given.world??questWorld?.row.interactions.rows.flatMap((entry):NativeMeleeWorld[]=>{
    if(entry.crack===undefined)return [];
    const spot=questWorld.spots.crack.find(point=>`crack.${point.id}`===entry.at);
    if(spot===undefined)throw new Error(`Missing admitted melee world spot ${entry.id}`);
    return [{act:entry.act,at:spot,radius:spot.radius,crack:entry.crack}];
  })??[];
  if(firstTargets.length>1024)throw new RangeError('Native melee world roster exceeds its bound');
  if(row.input?.world!==undefined&&worldActor===undefined)throw new Error('Native world commands require their quest actor');
  const noTargets:readonly NativeMeleeWorld[]=[];
  const holdStepped=row.held?.continuation.kind==='step';
  // P1-E3.5: a seat per player. Any player's lash cracks a quest's spots; world reactions stay the first player's.
  const seats=playerSeats(host,(player,first)=>{
  const ports:NativeMeleePorts=first?given:{inputCommands:()=>given.others?.commands(player)??[],enabled:()=>given.others?.enabled(player)??false,
    ...(given.hookTick===undefined?{}:{hookTick:given.hookTick}),...(given.others?.hook===undefined?{}:{hook:given.others.hook(player)})};
  const worldTargets=first||given.world===undefined?firstTargets:noTargets;
  /** The seq this tick's player command carries, and the one the running move took (J47). */
  let tickSeq=0,attackSeq=0;
  let inputTick=-1, inputStream:readonly NativeMeleeInput[]=[];
  const inputCommands=():readonly NativeMeleeInput[]=>{
    if(inputTick!==host.state.tick){inputStream=ports.inputCommands?.()??[];if(inputStream.length>MAX_TICK_COMMANDS)throw new RangeError('Native melee input exceeds its tick bound');inputTick=host.state.tick;}
    return inputStream;
  };
  const mapped:NativeMeleeCommand[]=[];
  const mappedCommands=():readonly NativeMeleeCommand[]=>{
    const policy=row.input;if(policy===undefined)return ports.commands?.()??mapped;
    mapped.length=0;
    for(const command of inputCommands()){
      if(command.kind==='player')tickSeq=command.seq??0;
      // A net client's blow carries its look, where a tape's comes as the aim actor's own script.
      if(command.kind==='player'&&policy.aimActor!==undefined&&(command.swing===true||command.secondary===true))mapped.push({kind:'aim',pitch:command.pitch??0});
      if(command.kind==='player'&&command.secondary===true){const second=policy.scripts.find(entry=>entry.action!==policy.attack&&entry.action!==row.held?.action);if(second!==undefined)mapped.push({kind:'move',action:second.action});}
      if(command.kind==='player'&&command.swing===true&&command.heavy===undefined)mapped.push({kind:'move',action:policy.attack,free:command.pitch??0});
      else if(command.kind==='player'&&command.attack!==undefined)mapped.push({kind:'move',action:policy.attack,...(command.attack.targetId===undefined?{}:{targetId:command.attack.targetId})});
      else if(command.kind==='script'){
        if(command.actorId===policy.aimActor&&command.value!==undefined)mapped.push({kind:'aim',pitch:command.value});
        else if(policy.world!==undefined&&command.actorId===worldActor){const target=worldTargets.find(entry=>entry.act===command.value);if(target!==undefined)mapped.push({kind:'move',world:target.act,action:target.crack==='heavy'?policy.world.heavy:policy.world.light});}
        else {const move=policy.scripts.find(entry=>entry.actor===command.actorId&&entry.value===command.value);if(move!==undefined)mapped.push({kind:'move',action:move.action});}
      }
    }
    return mapped;
  };
  const aimed = { target: null as string | null, world: null as number | null, dir: new Vector3(0, 0, -1) };
  const from = new Vector3(), direction = new Vector3(), targets = worldTargets;
  const volumes = { head: new Vector3(), headRadius: 0, a: new Vector3(), b: new Vector3(), bodyRadius: 0 };
  let cracked: number | null = null, pitch = 0;
  const port = (id: string): NativeMeleeTarget | null => {
    const actor = host.entities.get(id); return actor === undefined ? null : host.combat.targetPort(actor.combatActor(), actor, velocity => { actor.impulse(velocity); });
  };
  const eye = (out: Vector3): Vector3 => { out.copy(player.position); out.y += row.eye; return out; };
  const selected = (out: Vector3, dir: Vector3): boolean => {
    eye(out);
    const actor = aimed.target === null ? undefined : host.entities.get(aimed.target), spot = aimed.world === null ? undefined : targets.find(target => target.act === aimed.world);
    if (actor !== undefined) dir.copy(actor.position).setY(actor.position.y + actor.dims.bodyY * actor.scale).sub(out);
    else if (spot !== undefined) dir.set(spot.at.x, spot.at.y, spot.at.z).sub(out);
    else dir.copy(aimed.dir);
    if (dir.lengthSq() < 1e-9) { if (row.zeroAim === 'refuse') return false; dir.copy(aimed.dir); }
    dir.normalize(); aimed.dir.copy(dir); return true;
  };
  const world = targets.map(target => ({ at: new Vector3(target.at.x, target.at.y, target.at.z), radius: target.radius,
    crack: (heavy: boolean, second: boolean): boolean => {
      if (target.crack === 'light') { if (second) return false; cracked = target.act; return true; }
      if (heavy && second) cracked = target.act;
      return true;
    } }));
  const family = bindMeleeContacts<NativeMeleeTarget>(weapon.id, contacts, { owner: player.health, hit: request => host.combat.hit(attackSeq===0?request:{...request,attackSeq}),
    world: () => world, aim: selected,
    targets: () => [...host.entities.keys()].flatMap(id => { const target = port(id); return target === null || row.liveTargetsOnly && !target.hittable ? [] : [target]; }),
    react: target => ({ actor: target.actor, ...(target.impulse === undefined ? {} : { impulse: target.impulse }), stagger: (dir, strength) => { target.target.stagger?.(dir, strength); } }),
    ...(row.body === 'none' ? {} : { body: (origin: Vector3, dir: Vector3, reach: number) => {
      let best: { port: NativeMeleeTarget; point: Vector3 } | null = null, bestT = Infinity;
      if (host.entities.size > 1024) throw new RangeError('Native melee actor roster exceeds its bounded contact scan');
      const actors = host.entities.entries();
      for (let i = 0; i < Math.min(1024, host.entities.size); i++) {
        const next = actors.next(); if (next.done) break;
        const [id, actor] = next.value, target = port(id); if (target === null || !target.hittable) continue;
        actor.headWorld(volumes.head); actor.bodyCapsule(volumes.a, volumes.b);
        volumes.headRadius = actor.dims.headRadius * actor.scale; volumes.bodyRadius = actor.dims.bodyRadius * actor.scale;
        const t = nativeMeleeVolumeHit(origin, dir, reach, volumes);
        if (t !== null && t < bestT) { best = { port: target, point: origin.clone().addScaledVector(dir, t) }; bestT = t; }
      }
      return best;
    } }),
  });
  const holdRow=row.held, release={released:false,target:null as string|null}, heavy={kind:'move' as const,action:holdRow?.action??0,targetId:''};
  // A net client's charge has no target to name: it lands where they look when they let go, as a page's does.
  const freeHeavy={kind:'move' as const,action:holdRow?.action??0,free:0};
  let heldFree=false;
  const releasedCommands:NativeMeleeCommand[]=[heavy], releasedFree:NativeMeleeCommand[]=[freeHeavy], none:NativeMeleeCommand[]=[], noHeld:NativeHeldCommand[]=[];
  let heldTarget:string|null=null;
  const noRelease=():void=>undefined;
  const sampleHeld=(dt:number):void=>{
    release.released=false;release.target=null;
    if(!(ports.enabled?.()??true)){family.hold.reset();heldTarget=null;return;}
    const commands=ports.heldCommands?.()??(ports.inputCommands===undefined?noHeld:inputCommands());
    if(commands.length>MAX_TICK_COMMANDS)throw new RangeError('Held player input exceeds its tick bound');
    let held=false,target:string|null=null;
    for(const command of commands)if(command.kind==='player'){held=command.heavy!==undefined;target=command.heavy?.targetId??null;if(held)heldFree=command.swing===true;freeHeavy.free=command.pitch??0;}
    release.released=family.hold.held&&!held;release.target=release.released?heldTarget:target;
    family.hold.step(dt,true,held,noRelease);heldTarget=held?target:null;
  };
  const holdSnapshot=():string=>JSON.stringify({version:1,held:family.hold.elapsed,wasHeld:family.hold.held,target:heldTarget});
  const restoreHold=(saved:unknown):void=>{
    if(saved===undefined){family.hold.reset();heldTarget=null;return;}
    if(typeof saved!=='string')throw new Error('Invalid melee hold continuation');
    const state=v.parse(NativeHoldState,JSON.parse(saved));
    if(!state.wasHeld&&(state.held!==0||state.target!==null))throw new Error('Invalid inactive melee hold');
    family.hold.elapsed=state.held;family.hold.held=state.wasHeld;heldTarget=state.target;
  };
    const snapshot = (): SimValue => {
    const state: Record<string, SimValue> = {};
    for (const field of row.continuation.fields) {
      switch (field.source) {
        case 'constant': state[field.key] = field.constant ?? 0; break;
        case 'primary': state[field.key] = family.cooldown; break;
        case 'secondary': state[field.key] = family.secondaryCooldown; break;
        case 'time': state[field.key] = family.t; break;
        case 'heavy': state[field.key] = family.row(family.move).heavy; break;
        case 'landed': state[field.key] = family.landed; break;
        case 'target': state[field.key] = aimed.target; break;
        case 'world': state[field.key] = aimed.world; break;
        case 'direction': state[field.key] = aimed.dir.toArray(); break;
        default: throw new Error('Unknown native melee snapshot binding');
      }
    }
    if(holdRow?.continuation.kind==='field')state[holdRow.continuation.key]=holdSnapshot();
    if(attackSeq!==0)state['attackSeq']=attackSeq;
    return row.continuation.encoding === 'json' ? JSON.stringify(state) : state;
  };
  const restore = (inputState: unknown): void => {
    if (row.continuation.encoding === 'json' && typeof inputState !== 'string') throw new Error('Invalid native melee JSON continuation');
    const saved = v.parse(v.record(v.string(), v.unknown()), typeof inputState === 'string' && row.continuation.encoding === 'json' ? JSON.parse(inputState) : inputState);
    const holdKey=holdRow?.continuation.kind==='field'?holdRow.continuation.key:undefined;
    if(holdKey!==undefined)restoreHold(saved[holdKey]);
    attackSeq=v.parse(v.optional(v.pipe(v.number(),v.integer(),v.minValue(0)),0),saved['attackSeq']);
    if (Object.keys(saved).length !== row.continuation.fields.length+(holdKey!==undefined&&Object.hasOwn(saved,holdKey)?1:0)+(Object.hasOwn(saved,'attackSeq')?1:0)) throw new Error('Unexpected native melee continuation field');
    const values = { primary: 0, secondary: 0, time: -1, heavy: false, landed: 0, target: null as string | null, world: null as number | null, direction: [0, 0, -1] };
    for (const field of row.continuation.fields) {
      const value = saved[field.key];
      switch (field.source) {
        case 'constant': if (value !== field.constant) throw new Error('Invalid native melee continuation version'); break;
        case 'heavy': values.heavy = v.parse(v.boolean(), value); break;
        case 'target': values.target = v.parse(v.nullable(v.string()), value); break;
        case 'world': values.world = v.parse(v.nullable(v.pipe(v.number(), v.finite())), value); break;
        case 'direction': values.direction = v.parse(v.tuple([v.pipe(v.number(), v.finite()), v.pipe(v.number(), v.finite()), v.pipe(v.number(), v.finite())]), value); break;
        case 'primary': case 'secondary': case 'time': case 'landed': {
          const number = v.parse(v.pipe(v.number(), v.finite()), value);
          if (field.source === 'landed' && !Number.isInteger(number) || field.min !== undefined && number < field.min || field.max !== undefined && number > field.max) throw new Error('Native melee continuation outside its admitted bounds');
          values[field.source] = number; break;
        }
        default: throw new Error('Unknown native melee restore binding');
      }
    }
    const move = row.mode === 'timed' ? family.moves.findIndex(candidate => candidate.heavy === values.heavy) : family.move;
    if (move < 0) throw new Error('Missing native melee continuation move');
    family.cooldown = values.primary; family.secondaryCooldown = values.secondary; family.t = values.time; family.move = move; family.landed = values.landed;
    aimed.target = values.target; aimed.world = values.world; aimed.dir.fromArray(values.direction);
  };
  const processCommand=(command:NativeMeleeCommand,dt:number):void=>{
      if (command.kind === 'aim') return;
      const action = row.actions.find(candidate => candidate.action === command.action); if (action === undefined) return;
      if (command.free !== undefined) { const cos = Math.cos(command.free); aimed.dir.set(-Math.sin(player.yaw) * cos, Math.sin(command.free), -Math.cos(player.yaw) * cos); }
      else if (action.aim === 'selected' && command.world === undefined && (command.targetId === undefined || !host.entities.has(command.targetId))) return;
      if (row.mode === 'immediate' && action.aim === 'selected') { aimed.target = command.targetId ?? null; aimed.world = command.world ?? null; if (!selected(from, direction)) return; }
      const claimed = action.hook === null ? row.mode === 'timed' ? family.swing(action.move) : family.claim(action.move)
        : startMeleeSecondary(family, ports.hook ?? null, { tick: ports.hookTick?.() ?? host.state.tick, dt, action: action.hook, move: action.move }) !== null;
      if (!claimed) return;
      attackSeq=tickSeq; player.swung(tickSeq, family.row(action.move).heavy);
      if (row.mode === 'timed') { aimed.target = command.targetId ?? null; aimed.world = command.world ?? null; }
      else {
        if (action.aim === 'facing') { eye(from); const cos = Math.cos(pitch); direction.set(-Math.sin(player.yaw) * cos, Math.sin(pitch), -Math.cos(player.yaw) * cos); }
        family.land(action.move, 0, from, direction); ports.landed?.(command.action, from, direction);
      }
  };
  const step=(dt:number):void=>{
    if (row.commandsAfterCool) family.cool(dt);
    if(holdRow?.continuation.kind==='field'||(holdStepped&&!first))sampleHeld(dt);
    let commands=ports.enabled?.()===false?none:mappedCommands();
    if(holdRow?.mode==='replace'&&release.released&&release.target!==null){family.cooldown=0;heavy.targetId=release.target;commands=releasedCommands;}
    else if(holdRow?.mode==='replace'&&release.released&&heldFree){family.cooldown=0;commands=releasedFree;}
    if (commands.length > MAX_TICK_COMMANDS) throw new RangeError('Native melee commands exceed the protocol allowance');
    cracked = null; if (!row.commandsAfterCool) family.cool(dt); pitch = 0;
    if (row.pitchLimit !== null) for (const command of commands) if (command.kind === 'aim') pitch = Math.max(-row.pitchLimit, Math.min(row.pitchLimit, command.pitch));
    for(const command of commands)processCommand(command,dt);
    if(holdRow?.mode==='after'&&release.released){family.cooldown=0;heavy.targetId=release.target??'';processCommand(heavy,dt);}
    if (row.mode === 'timed') family.advance(dt);
  };
  return { family, cracked: () => cracked, sampleHeld, holdSnapshot, restoreHold, step,
    // the first player's hold keeps its own adapter; another's rides with its seat
    snapshot: ():SimValue => first||!holdStepped?snapshot():{melee:snapshot(),hold:holdSnapshot()},
    restore: (value:unknown):void => { if(first||!holdStepped){restore(value);return;} const saved=v.parse(v.strictObject({melee:v.unknown(),hold:v.string()}),value); restore(saved.melee); restoreHold(saved.hold); } };
  });
  const {lead}=seats;
  if(row.held?.continuation.kind==='step')host.onStep(row.held.continuation.id,lead.sampleHeld,{snapshot:lead.holdSnapshot,restore:lead.restoreHold});
  host.onStep(row.step, seats.step, seats.adapter);
  return { family: lead.family, cracked: player => { const body = host.players.get(player); return body === undefined ? null : seats.of(body).cracked(); } };
}

/** A named cable service lends its existing driver, fixed step and continuation. Missing ids must refuse in state. */
export interface QuestCableOwner {
  readonly state: (id: string) => { readonly riding: boolean; readonly atEnd: boolean };
  readonly start: (id: string) => void;
  /** Every other player's place at the cable: their own ride, ending on their own flags. */
  readonly seat: (id: string, player: PlayerSim, flags: Flags) => unknown;
  readonly seatState: (id: string, player: string) => { readonly riding: boolean; readonly atEnd: boolean };
  readonly startSeat: (id: string, player: string) => void;
}
/** Platform-installed mechanics, never per-shard callback maps. This host constructs no replacement owners. */
export interface QuestMechanics {
  readonly motion?: Pick<MoverRuntime, 'data' | 'atEnd' | 'pose' | 'command'>;
  readonly cables?: QuestCableOwner;
  readonly encounters?: ReadonlyMap<string, { readonly summon: () => void }>;
}

/** Actual native owners borrowed by an admitted quest host; no body, mover or encounter is constructed here. */
export interface QuestHostPorts extends Omit<QuestGraphPorts, 'drive' | 'summon'> {
  /** Boolean observations such as a mover's enabled pose, keyed by the authored owner id. */
  readonly observations?: ReadonlyMap<string, (player: string) => boolean>;
  /** Accepted external commands delivered to their original native owner. */
  readonly actions?: ReadonlyMap<string, (value: number, player: string) => void>;
  /** Stage actions retain their native effect owner, keyed by director id. Flag actions are bound automatically. */
  readonly directorActions?: ReadonlyMap<string, readonly DirectorActionBinding[]>;
  readonly mechanics?: QuestMechanics;
}

/** The cable with `player` seated at it; undefined once they have left. */
function seatedCable(host: SimHost, cables: QuestCableOwner, id: string, player: string): QuestCableOwner | undefined {
  const body = host.players.get(player);
  if (body === undefined) return undefined;
  cables.seat(id, body, questBooks(host).of(player).flags);
  return cables;
}

function questObservation(host: SimHost, row: QuestHostRow['observations'][number], ports: QuestHostPorts): (player: string) => boolean {
  switch (row.kind) {
    case 'all-dead': return () => row.actors.every(id => host.entities.get(id)?.alive === false);
    case 'owner': {
      const read = ports.observations?.get(row.owner);
      if (read === undefined) throw new Error(`Unbound quest observation ${row.owner}`);
      return read;
    }
    case 'timer': {
      if (!Object.hasOwn(host.state.timers, row.timer)) throw new Error(`Unbound quest timer ${row.timer}`);
      return () => { const left = host.state.timers[row.timer]; if (left === undefined || !Number.isFinite(left) || left < 0) throw new Error('Invalid quest timer'); return left === 0; };
    }
    case 'cable': {
      const cables = ports.mechanics?.cables;
      if (cables === undefined) throw new Error(`Unbound quest cable ${row.cable}`);
      cables.state(row.cable);
      const books = questBooks(host);
      return player => {
        const ride = player === books.lead.player ? cables.state(row.cable) : seatedCable(host, cables, row.cable, player)?.seatState(row.cable, player);
        return ride !== undefined && (row.state === 'riding' ? ride.riding : ride.atEnd);
      };
    }
    case 'mover': {
      const motion = ports.mechanics?.motion;
      if (motion === undefined || !motion.data.some(value => value.id === row.mover)) throw new Error(`Unbound quest mover ${row.mover}`);
      if (row.state === 'at-end') { motion.atEnd(row.mover); return () => motion.atEnd(row.mover); }
      motion.pose(row.mover); return () => motion.pose(row.mover).enabled;
    }
    default: throw new Error('Unsupported quest observation');
  }
}

/** Compose an admitted quest graph, bounded command routes and ordered director stages on their original fixed steps.
 * Required owners refuse before installation. Quiet seeds and individual continuation strings preserve existing saves;
 * a transient flag stage introduces no saved cursor. The caller still owns all body, mover and encounter lifetimes. */
export interface NativeQuestHost extends ReturnType<typeof installQuestGraph> {
  /** Dispatch one accepted command at its existing owner's phase; adds no step or saved cursor. */
  readonly accept: (command: QuestHostCommand) => boolean;
  /** Deliver the protocol-bounded batch in order, observing each preceding command's effects. */
  readonly dispatch: (commands: readonly QuestHostCommand[]) => void;
}
/** One script command for a quest: `playerId` names who acted, the lead when absent. */
export interface QuestHostCommand { readonly actorId: string; readonly value: number; readonly playerId?: string | undefined }
export function installQuestHost(host: SimHost, quests: QuestData, input: QuestHostRow, ports: QuestHostPorts): NativeQuestHost {
  const row = parseQuestHost(input);
  if (ports.prompts !== undefined && ports.prompts.length > 1024) throw new Error('Quest prompt roster exceeds its finite bound');
  if (row.actors.ids.some(id => host.entities.get(id) === undefined)) throw new Error(row.actors.error);
  const observations = new Map(row.observations.map(observation => [observation.binding, questObservation(host, observation, ports)]));
  const actions = new Map<QuestHostRow['commands']['routes'][number], (value: number, player: string) => void>(), books = questBooks(host);
  for (const route of row.commands.routes) {
    if (route.spot !== null && !(ports.prompts === undefined ? [...row.npcs.map(npc => npc.spot), ...ports.spots.interact.map(spot => spot.id), ...ports.spots.crack.map(spot => `crack.${spot.id}`)] : ports.prompts.map(prompt => prompt.id)).includes(route.spot)) throw new Error(`Undeclared quest spot ${route.spot}`);
    if (route.action.kind === 'owner') {
      const owner = ports.actions?.get(route.action.id);
      if (owner === undefined) throw new Error(`Unbound quest command ${route.action.id}`);
      actions.set(route, owner);
    } else if (route.action.kind === 'mover') {
      const action = route.action, motion = ports.mechanics?.motion;
      if (motion === undefined || !motion.data.some(value => value.id === action.mover)) throw new Error(`Unbound quest mover ${action.mover}`);
      actions.set(route, (_value, player) => { motion.command(action.mover, action.command, player === books.lead.player ? undefined : player); });
    } else if (route.action.kind === 'cable') {
      const action = route.action, cables = ports.mechanics?.cables;
      if (cables === undefined) throw new Error(`Unbound quest cable ${action.cable}`);
      cables.state(action.cable);
      actions.set(route, (_value, player) => { if (player === books.lead.player) cables.start(action.cable); else seatedCable(host, cables, action.cable, player)?.startSeat(action.cable, player); });
    } else if (route.action.kind === 'flag') {
      const action = route.action; books.claim([action.flag]); actions.set(route, (_value, player) => { books.of(player).flags.set(action.flag, action.value); });
    }
  }
  const observe = (binding: string, player: string = books.lead.player): boolean => {
    const owner = observations.get(binding);
    if (owner === undefined) throw new Error(`Unbound quest observation ${binding}`);
    return owner(player);
  };
  const stages = row.stages.map(stage => ({ row: stage, lane: bindDirectorActions(stage.row, {
    flags: host.flags, observe, bindings: ports.directorActions?.get(stage.row.id) ?? stage.row.stages.flatMap(entry => entry.do.flatMap(action => {
      if (!('spawn' in action)) return [];
      const encounter = ports.mechanics?.encounters?.get(action.spawn);
      if (encounter === undefined) throw new Error(`Unbound quest encounter ${action.spawn}`);
      return [{ action, run: () => { encounter.summon(); } }];
    })),
    initial: stage.seed !== undefined && host.flags.has(stage.seed.flag) ? stage.seed.initial : stage.initial,
  }) }));
  const requests = new Map(row.summons.map(request => {
    const stage = stages.find(candidate => candidate.row.row.id === request.director);
    if (stage === undefined) throw new Error(`Undeclared quest director ${request.director}`);
    return [request.target, stage.lane] as const;
  }));
  const routes = row.commands.routes.map(route => ({ ...route, authored: route, condition: compileDirectorWhen(route.when, Object.keys(row.commands.inputs)) }));
  // Continuations are registered in authored order, before the interaction graph as on the shipping native hosts.
  for (const { row: stage, lane } of stages) {
    const saved = stage.continuation;
    if (saved !== undefined) host.onStep(saved.step, () => undefined, {
      snapshot: () => lane.snapshot(), restore: value => { if (typeof value !== 'string') throw new Error(saved.error); lane.restore(value); },
    });
  }
  const graph = installQuestGraph(host, { quests, graph: row.graph, interactions: row.interactions, npcs: row.npcs }, {
    ...ports, drive: row.drive, summon: target => { requests.get(target)?.advance(); },
  });
  // A net client names what it uses; the route it takes is the tick command a tape would send.
  const named = actRoutes(host).interactions;
  for (const route of routes) if (route.value !== null && (route.action.kind === 'row' || route.action.kind === 'owner') && !named.has(route.action.id)) named.set(route.action.id, { actorId: route.actor ?? row.graph.actor, value: route.value });
  for (const route of routes) if (route.value !== null && route.action.kind === 'cable' && !named.has(route.action.cable)) named.set(route.action.cable, { actorId: route.actor ?? row.graph.actor, value: route.value });
  // A mover a prompt runs goes by that prompt's spot: the route's own condition is what says yes.
  for (const route of routes) if (route.value !== null && route.action.kind === 'mover' && route.spot !== null && !named.has(route.spot)) named.set(route.spot, { actorId: route.actor ?? row.graph.actor, value: route.value });
  const accept: NativeQuestHost['accept'] = command => {
    const player = command.playerId ?? books.lead.player;
    // a player the host no longer holds has no command to run
    if (!host.players.has(player)) return false;
    const { flags } = books.of(player);
    for (const route of routes) {
      if (command.actorId !== (route.actor ?? row.graph.actor) || route.value !== null && route.value !== command.value) continue;
      if (route.spot !== null && !graph.near(route.spot, player)) continue;
      const values = Object.fromEntries(Object.entries(row.commands.inputs).map(([key, binding]) => [key, binding.startsWith('flag:') ? flags.has(binding.slice(5)) : observe(binding, player)]));
      if (!evaluateDirectorWhen(route.condition, values)) continue;
      if (route.action.kind === 'row') graph.run(route.action.id, undefined, player);
      else {
        actions.get(route.authored)?.(command.value, player);
      }
      return true;
    }
    return false;
  };
  const dispatch: NativeQuestHost['dispatch'] = commands => {
    for (let index = 0; index < 1024; index++) {
      const command = commands[index]; if (command === undefined) break;
      accept(command);
    }
  };
  if (row.commands.step !== null) host.onStep(row.commands.step, () => {
    dispatch(ports.commands());
    for (const stage of stages) if (stage.row.tick) stage.lane.advance();
  });
  return { ...graph, accept, dispatch };
}

/** Borrowed world reaction owners; no hit, flag, prompt or saved state is reconstructed. */
export interface QuestWorldReactionPorts {
  readonly flags: Pick<Flags, 'has' | 'set'>;
  readonly point?: (row: Extract<QuestWorldReactionsData[number]['at'], { readonly kind: 'owner' }>) => Vector3;
  readonly run?: (id: string) => boolean;
  readonly toast?: (text: string) => void;
}
/** Actual contact targets and the same cone scan for browser and renderer-free quest owners. */
export interface QuestWorldReactions {
  readonly targets: readonly ContactWorldTarget[];
  readonly scan: (from: Vector3, dir: Vector3) => number;
}
/** Bind a bounded hit roster once; the engine's contact-distance law and actual flags remain authoritative. */
export function bindQuestWorldReactions(input: QuestWorldReactionsData, ports: QuestWorldReactionPorts): QuestWorldReactions {
  const rows = parseQuestWorldReactions(input).map(row => {
    if (row.action !== undefined && ports.run === undefined) throw new Error(`Missing quest world action ${row.action}`);
    const at = row.at.kind === 'point' ? new Vector3(row.at.x, row.at.y, row.at.z) : ports.point?.(row.at);
    if (at === undefined) throw new Error(`Missing quest world point ${row.id}`);
    const react = (heavy: boolean, second: boolean): boolean => {
      if (row.needs !== undefined && !testQuestFlags(ports.flags, row.needs)) return false;
      if (row.heavy === true && !heavy) { if (row.lightHint !== undefined) ports.toast?.(row.lightHint); return true; }
      if (row.second === true && !second) return true;
      if (row.action !== undefined && ports.run?.(row.action) !== true) return false;
      for (const flag of row.sets ?? []) ports.flags.set(flag);
      if (row.toast !== undefined) ports.toast?.(row.toast);
      return true;
    };
    return { row, at, react };
  });
  return {
    targets: rows.filter(entry => entry.row.cone === undefined).map(entry => ({ at: entry.at, radius: entry.row.radius, crack: entry.react })),
    scan: (from, dir) => {
      let accepted = 0;
      for (const { row, at, react } of rows) if (row.cone !== undefined
        && weaponContactDistance(from, dir, at, 'cone', row.cone.reach, row.cone.halfAngle) !== null && react(true, true)) accepted++;
      return accepted;
    },
  };
}

/** Select only the admitted root composition; missing or unbound rows refuse before any borrowed owner is read. */
export function installDeclaredQuestHost(host: SimHost, source: Shardfile, ports: QuestHostPorts): NativeQuestHost {
  if (source.questHost === undefined || source.questHost === null || source.runtime?.binds?.includes('quests') !== true && !hasDeclaredClientPage(source)) throw new Error('Missing admitted native quest host');
  return installQuestHost(host, source.quests, source.questHost, ports);
}



const nativeActorMetadata = v.object({ kind: v.string(), spec: v.unknown() });
const nativeWorldMetadata: v.GenericSchema<BoundedNativeWorldMetadataInput, BoundedNativeWorldMetadata> = v.object({ actors: v.array(v.object({ kind: v.exactOptional(v.string()), spec: v.unknown() })) });
const nativeQuestSpot = v.strictObject({ id: v.string(), x: bakedNumber, y: bakedNumber, z: bakedNumber, radius: v.pipe(bakedNumber, v.minValue(0)) });
const nativeQuestMetadata: v.GenericSchema<BoundedNativeQuestMetadataInput, BoundedNativeQuestMetadata> = v.object({ actors: v.array(nativeActorMetadata), bosses: v.array(nativeActorMetadata),
  spots: v.strictObject({ interact: v.array(nativeQuestSpot), crack: v.array(nativeQuestSpot) }), promptRegistrations: v.optional(v.unknown()) });
/** Read native actor metadata, requiring complete quest spots and boss rows when requested. Collision rows remain addBakedWorld's responsibility. */
export function readRuntimeWorldMetadata(input: unknown, quests: true): v.InferOutput<typeof nativeQuestMetadata>;
export function readRuntimeWorldMetadata(input: unknown): v.InferOutput<typeof nativeWorldMetadata>;
export function readRuntimeWorldMetadata(input: unknown, quests = false): v.InferOutput<typeof nativeWorldMetadata> | v.InferOutput<typeof nativeQuestMetadata> {
  return quests ? v.parse(nativeQuestMetadata, input) : v.parse(nativeWorldMetadata, input);
}


/** Bounded ordered native equipment slots and their lower/raise clocks. */
export interface NativeLoadoutRow<Slot extends number> {
  readonly slots: readonly Slot[]; readonly initial: Slot;
  readonly lower: number; readonly raise: number;
  readonly ownership?: readonly (string | null)[];
  readonly input?: v.InferOutput<typeof NativeLoadoutRowSchema>['input'];
}
/** Borrowed ownership and input lock; creating a loadout installs no step. */
export interface NativeLoadoutPorts<Slot extends number> {
  readonly owned?: (slot: Slot) => boolean; readonly flags?: Pick<Flags, 'has'>; readonly locked: () => boolean;
}
/** Detached native slot continuation; the old held/swap save shape is retained. */
export interface NativeLoadoutSnapshot<Slot extends number> extends Readonly<Record<string, SimValue>> {
  readonly held: Slot;
  readonly swap: { readonly to: Slot; readonly t: number; readonly switched: boolean } | null;
}
/** One selection owner, borrowed by an existing simulation adapter. */
export interface NativeLoadout<Slot extends number> {
  readonly held: () => Slot; readonly swapping: () => boolean;
  readonly owned: (slot: Slot) => boolean; readonly live: (slot: Slot) => boolean; readonly armed: (slot: Slot) => boolean;
  readonly select: (slot: Slot) => void; readonly step: (dt: number, pick: Slot | null) => void;
  readonly snapshot: () => NativeLoadoutSnapshot<Slot>; readonly restore: (value: unknown) => void;
}
/** The frame a kit publishes what is in hand to. */
export interface NativeLoadoutFrame { readonly scripts: ReadonlyMap<string, number>; readonly live: Set<number>; readonly armed: Set<number>; aim: number }
/** Bind one or several native item slots without taking over weapon/ammunition
 * continuations. Optional stepping keeps the existing id, phase and save shape;
 * the body list and aim reader remain live while ranged items are stowed.
 */
export function bindNativeLoadout<Slot extends number>(host: SimHost, row: NativeLoadoutRow<Slot>,
  ports: Omit<NativeLoadoutPorts<Slot>, 'locked'> & { readonly locked?: () => boolean; readonly aim?: () => number;
    /** The lock read of the player whose seat it is, in place of `locked`. */
    readonly lockedFor?: (player: PlayerSim) => boolean;
    readonly frame?: NativeLoadoutFrame;
    /** P1-E3.5: another player's frame and lock. Absent, only the first player holds this kit. */
    readonly others?: { readonly frame: (player: PlayerSim) => NativeLoadoutFrame; readonly locked: (player: PlayerSim) => boolean };
    readonly step?: { readonly id: string; readonly phase: 'beforeBodies' | 'afterBodies'; readonly pick: (player: PlayerSim, first: boolean) => number | null } }):
  NativeLoadout<Slot> & { readonly aim: () => number; readonly bodies: () => readonly NonNullable<ReturnType<SimHost['entities']['get']>>[] } {
  const publication = row.input?.publication, frame = ports.frame, step = ports.step, others = ports.others;
  if (publication !== undefined && frame === undefined) throw new Error('Native input publication requires its combat frame');
  const seats = playerSeats(host, (player, first) => {
    const lockedFor = ports.lockedFor, locked = first ? ports.locked ?? (() => lockedFor?.(player) ?? false) : () => (others?.locked ?? lockedFor)?.(player) ?? true;
    const loadout = createNativeLoadout(row, { ...ports, locked }), own = first ? frame : others?.frame(player);
    return { loadout,
      step: (dt: number): void => { if (step === undefined || (!first && others === undefined)) return; const picked = step.pick(player, first); loadout.step(dt, row.slots.find(slot => slot === picked) ?? null); player.held = loadout.held(); },
      snapshot: (): SimValue => loadout.snapshot(), restore: loadout.restore,
      publish: (): void => {
        if (publication === undefined || own === undefined) return;
        const aim = publication.aim, value = own.scripts.get(aim.command) ?? aim.initial;
        own.aim = value === aim.sentinel ? value : Number.isFinite(value) ? Math.min(aim.max, Math.max(aim.min, value)) : aim.initial;
        own.live.clear(); own.armed.clear();
        for (let index = 0; index < 32; index++) { const slot = row.slots[index]; if (slot === undefined) break; if (loadout.live(slot)) own.live.add(slot); if (loadout.armed(slot)) own.armed.add(slot); }
      } };
  }), { loadout } = seats.lead;
  if (step !== undefined) host.onStep(step.id, seats.step, seats.adapter, step.phase);
  if (row.input !== undefined) actRoutes(host).equip = row.input.command;
  if (publication !== undefined && frame !== undefined) {
    host.onStep(publication.step, () => { for (const player of host.players.values()) seats.of(player).publish(); }, undefined, publication.phase);
  }
  const bodies: NonNullable<ReturnType<SimHost['entities']['get']>>[] = [];
  return { ...loadout, aim: ports.aim ?? (() => 0.5), bodies: () => {
    bodies.length = 0; host.entities.forEach(body => { bodies.push(body); }); return bodies;
  } };
}
/** One renderer-free equipment selection owner for timed and immediate kits.
 * The caller registers step/snapshot in its existing adapter, preserving order.
 */
export function createNativeLoadout<Slot extends number>(row: NativeLoadoutRow<Slot>, ports: NativeLoadoutPorts<Slot>): NativeLoadout<Slot> {
  parseNativeLoadoutRow(row);
  if (row.ownership === undefined && ports.owned === undefined) throw new Error('Native equipment requires ownership policy');
  if (row.ownership?.some(flag => flag !== null) === true && ports.flags === undefined) throw new Error('Native equipment requires flags');
  const owned = row.ownership === undefined ? ports.owned : (value: Slot): boolean => {
    const index = row.slots.indexOf(value), flag = row.ownership?.[index];
    return index !== -1 && (flag === null || (flag !== undefined && ports.flags?.has(flag) === true));
  };
  if (owned === undefined) throw new Error('Native equipment requires ownership');
  const slot = v.custom<Slot>(value => row.slots.some(candidate => candidate === value));
  const Saved = v.strictObject({ held: slot, swap: v.nullable(v.strictObject({ to: slot,
    t: v.pipe(v.number(), v.finite(), v.minValue(0)), switched: v.boolean() })) });
  let held = row.initial;
  const swap = { on: false, to: row.initial, t: 0, switched: false };
  const finish = (): void => { if (swap.on) { held = swap.to; swap.on = false; } };
  const select = (to: Slot): void => {
    if (!row.slots.includes(to) || !owned(to)) return;
    if (swap.on) { if (swap.to === to) return; finish(); }
    if (to === held) return;
    swap.on = true; swap.to = to; swap.t = 0; swap.switched = false;
    if (row.lower === 0) { held = to; swap.switched = true; }
    if (row.lower + row.raise === 0) finish();
  };
  const step = (dt: number, pick: Slot | null): void => {
    if (pick !== null) select(pick);
    if (!swap.on) return;
    swap.t += dt;
    if (swap.t >= row.lower && !swap.switched) { swap.switched = true; held = swap.to; }
    if (swap.t >= row.lower + row.raise) finish();
  };
  return { held: (): Slot => held, swapping: (): boolean => swap.on, owned, select, step,
    live: (value: Slot): boolean => held === value && !swap.on && !ports.locked(),
    armed: (value: Slot): boolean => held === value && !ports.locked(),
    snapshot: (): NativeLoadoutSnapshot<Slot> => ({ held, swap: swap.on ? { to: swap.to, t: swap.t, switched: swap.switched } : null }),
    restore: (value: unknown): void => {
      const saved = v.parse(Saved, value);
      held = saved.held; swap.on = saved.swap !== null;
      if (saved.swap !== null) { swap.to = saved.swap.to; swap.t = saved.swap.t; swap.switched = saved.swap.switched; }
    },
  };
}


/** Posed geometric contact volumes; the caller retains actor/physics authority. */
export interface NativeContactVolumes extends NativeMeleeVolumes {
  readonly fore?: { readonly a: Vector3; readonly b: Vector3; readonly radius: number } | null;
}
/** Caller-owned result storage, refilled without per-query allocation. */
export interface NativeVolumeContact { distance: number; point: Vector3; head: boolean }
const contactAp = new Vector3(), contactAb = new Vector3(), contactAo = new Vector3();
/** The distance along the unit ray (origin, dir) to a ball, within `max`, or Infinity (0 from inside it, as Rapier's solid cast). */
function contactSphereRay(origin: Vector3, dir: Vector3, centre: Vector3, r: number, max: number): number {
  contactAp.subVectors(origin, centre);
  const b = contactAp.dot(dir), c = contactAp.lengthSq() - r * r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (b > 0 || disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t <= max ? t : Infinity;
}
/** The distance along the unit ray to a capsule (segment a–b, radius r), within `max`, or Infinity: the analytic cast (the
 *  side of the cylinder, else the nearer end ball), 0 from inside it, as Rapier's solid cast of the page's hitbox. */
function contactCapsuleRay(origin: Vector3, dir: Vector3, a: Vector3, b: Vector3, r: number, max: number): number {
  contactAb.subVectors(b, a); contactAo.subVectors(origin, a);
  const baba = contactAb.lengthSq();
  if (baba < 1e-12) return contactSphereRay(origin, dir, a, r, max);
  const u = Math.min(1, Math.max(0, contactAo.dot(contactAb) / baba));
  if (contactAp.copy(a).addScaledVector(contactAb, u).distanceToSquared(origin) <= r * r) return 0;
  const bard = contactAb.dot(dir), baoa = contactAb.dot(contactAo), rdoa = dir.dot(contactAo), oaoa = contactAo.lengthSq();
  const k2 = baba - bard * bard, k1 = baba * rdoa - baoa * bard, k0 = baba * oaoa - baoa * baoa - r * r * baba;
  let t = Infinity;
  if (k2 > 1e-12) {
    const h = k1 * k1 - k2 * k0;
    if (h < 0) return Infinity;
    const side = (-k1 - Math.sqrt(h)) / k2, y = baoa + side * bard;
    if (y > 0 && y < baba && side >= 0) t = side;
  }
  if (t === Infinity) t = Math.min(contactSphereRay(origin, dir, a, r, max), contactSphereRay(origin, dir, b, r, max));
  return t <= max ? t : Infinity;
}

const contactNear = new Vector3(), contactDelta = new Vector3();
function contactCapsuleSkin(origin: Vector3, a: Vector3, b: Vector3, radius: number, best: number, out: NativeVolumeContact): number {
  contactAb.subVectors(b, a);
  const along = contactAb.lengthSq() < 1e-12 ? 0 : Math.min(1, Math.max(0, contactDelta.subVectors(origin, a).dot(contactAb) / contactAb.lengthSq()));
  contactNear.copy(a).addScaledVector(contactAb, along);
  const skinDistance = Math.max(0, contactNear.distanceTo(origin) - radius);
  if (skinDistance < best) { out.point.copy(contactNear).sub(origin).setLength(skinDistance).add(origin); out.head = false; return skinDistance; }
  return best;
}
/** Query one posed head/body/fore volume set. A unit direction selects a solid
 * ray hit; null selects the nearest skin point to origin. World cover, target
 * ordering, damage and hit events remain with the original weapon owner.
 */
export function nativeVolumeContact(origin: Vector3, direction: Vector3 | null, limit: number,
  body: NativeContactVolumes, out: NativeVolumeContact): boolean {
  if (direction !== null) {
    const head = contactSphereRay(origin, direction, body.head, body.headRadius, limit);
    const trunk = contactCapsuleRay(origin, direction, body.a, body.b, body.bodyRadius, Math.min(limit, head));
    const fore = body.fore === undefined || body.fore === null ? Infinity
      : contactCapsuleRay(origin, direction, body.fore.a, body.fore.b, body.fore.radius, Math.min(limit, head, trunk));
    out.distance = Math.min(head, trunk, fore); out.head = head <= Math.min(trunk, fore);
    if (!Number.isFinite(out.distance) || out.distance > limit) return false;
    out.point.copy(origin).addScaledVector(direction, out.distance);
    return true;
  }
  let best = Math.max(0, body.head.distanceTo(origin) - body.headRadius);
  out.point.copy(body.head).sub(origin).setLength(best).add(origin); out.head = true;
  best = contactCapsuleSkin(origin, body.a, body.b, body.bodyRadius, best, out);
  if (body.fore !== undefined && body.fore !== null) best = contactCapsuleSkin(origin, body.fore.a, body.fore.b, body.fore.radius, best, out);
  out.distance = best;
  return best <= limit;
}


/** Trusted posed-volume reader; a roster can lend its last synchronized pose. */
export interface NativeTargetPose {
  readonly headWorld: (out: Vector3) => Vector3;
  readonly bodyCapsule: (rear: Vector3, front: Vector3) => void;
  readonly foreCapsule?: (rear: Vector3, front: Vector3) => boolean;
}
/** Minimal actor query port. Ownership, bodies and hit events stay with the host. */
export interface NativeTargetBody extends NativeTargetPose {
  readonly alive: boolean; readonly hidden?: boolean; readonly scale: number;
  readonly position: Vector3;
  readonly dims: { readonly headRadius: number; readonly bodyRadius: number;
    readonly bodyHalfLen: number; readonly bodyY: number; readonly fore?: { readonly radius: number } };
}
/** Reused nearest ray result. Copy its point before another query if retained. */
export interface NativeTargetHit<T extends NativeTargetBody> {
  body: T | null; head: boolean; distance: number; point: Vector3;
}
/** One owned pose/scratch reader, with bounded original-order roster queries. */
export interface NativeTargetQueries<T extends NativeTargetBody> {
  readonly ray: (bodies: readonly T[], origin: Vector3, direction: Vector3, max: number) => NativeTargetHit<T> | null;
  readonly closest: (body: T, origin: Vector3, limit: number, out: NativeVolumeContact) => boolean;
}
/** Construct the shared ray-roster/closest-skin query owner. No actor or Rapier
 * state is changed; the optional pose port borrows a synchronized hitbox view.
 * Fore capsules are enabled unless a contact row explicitly omits them.
 */
export function createNativeTargetQueries<T extends NativeTargetBody>(ports: {
  readonly pose?: (body: T) => NativeTargetPose; readonly fore?: boolean;
} = {}): NativeTargetQueries<T> {
  const volumes: { head: Vector3; headRadius: number; a: Vector3; b: Vector3; bodyRadius: number;
    fore: { a: Vector3; b: Vector3; radius: number } | null } = {
      head: new Vector3(), headRadius: 0, a: new Vector3(), b: new Vector3(), bodyRadius: 0, fore: null,
    };
  const fore = { a: new Vector3(), b: new Vector3(), radius: 0 };
  const result = { distance: 0, point: new Vector3(), head: false };
  const hit: NativeTargetHit<T> = { body: null, head: false, distance: 0, point: new Vector3() };
  const read = (body: T): void => {
    const pose = ports.pose?.(body) ?? body, d = body.dims, s = body.scale;
    pose.headWorld(volumes.head); volumes.headRadius = d.headRadius * s;
    pose.bodyCapsule(volumes.a, volumes.b); volumes.bodyRadius = d.bodyRadius * s;
    volumes.fore = null;
    if (ports.fore !== false && d.fore !== undefined && pose.foreCapsule?.(fore.a, fore.b) === true) {
      fore.radius = d.fore.radius * s; volumes.fore = fore;
    }
  };
  return {
    ray: (bodies, origin, direction, max) => {
      let found = false, best = max;
      for (let i = 0; i < 512; i++) {
        const body = bodies[i]; if (body === undefined) break;
        if (!body.alive || body.hidden === true) continue;
        const d = body.dims, s = body.scale;
        if (body.position.distanceTo(origin) > best + (d.bodyHalfLen + d.bodyRadius + d.headRadius) * s + d.bodyY * s + 2) continue;
        read(body);
        if (nativeVolumeContact(origin, direction, best, volumes, result) && result.distance < best) {
          best = result.distance; found = true; hit.body = body; hit.head = result.head;
          hit.distance = best; hit.point.copy(result.point);
        }
      }
      return found ? hit : null;
    },
    closest: (body, origin, limit, out) => { read(body); return nativeVolumeContact(origin, null, limit, volumes, out); },
  };
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedNativeWorldMetadataInput = BoundedNativeWorldMetadata;
interface BoundedNativeWorldMetadataFields {
    actors: {
        kind?: string;
        spec: unknown;
    }[];
}
type BoundedNativeWorldMetadata = { [Key in keyof BoundedNativeWorldMetadataFields]: BoundedNativeWorldMetadataFields[Key] };
type BoundedNativeQuestMetadataInput = BoundedNativeQuestMetadata;
interface BoundedNativeQuestMetadataFields {
    actors: {
        kind: string;
        spec: unknown;
    }[];
    bosses: {
        kind: string;
        spec: unknown;
    }[];
    spots: {
        interact: {
            id: string;
            x: number;
            y: number;
            z: number;
            radius: number;
        }[];
        crack: {
            id: string;
            x: number;
            y: number;
            z: number;
            radius: number;
        }[];
    };
    promptRegistrations?: unknown;
}
type BoundedNativeQuestMetadata = { [Key in keyof BoundedNativeQuestMetadataFields]: BoundedNativeQuestMetadataFields[Key] };
