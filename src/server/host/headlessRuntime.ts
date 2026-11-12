import {createTrustedHeadlessTape} from '../../shared/host/headlessTape';
import * as v from 'valibot';
import { runHeadlessJourney } from '../../shared/host/headlessJourney';
import { registerNativeQuestInputs } from '@wildshard/engine/game/quest/nativeInputs';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { prepareAssetDecoders } from '@wildshard/format/product';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { MoverScriptDriver, type MoverRuntime } from '@wildshard/engine/game/plugin/mover';
import { installRopeDecks } from './ropeDecks';
import type { NearColliders } from '@wildshard/engine/physics/nearColliders';
import { installCableModes } from '@wildshard/engine/player/modes';
import { createNativeCombatFrame, nativeRangedItem, otherCombatFrame, readNativeRangedItem, type NativeCombatFrame, type NativeRangedItem } from '@wildshard/engine/game/plugin/nativeItems';
import { prepareRuntimePlan, ledgerPorts, pickCommands } from '@wildshard/engine/game/plugin/simulation';
import { HEADLESS_ARENA } from '@wildshard/engine/game/boss/headlessArenaViews';
import type { NativeSweptMeleeInput } from '@wildshard/engine/game/plugin/nativeSwept';
import { installPortableMath } from '@wildshard/engine/core/portableMath';
import { createSimHost, type SimHost, type SimHostPorts, type SimLevel, type SimTickCommand } from '@wildshard/engine/sim';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { NetTickAct } from '@wildshard/engine/net/acts';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { netInteractCommands, netRide, netTickCommands } from '../../shared/host/standalone/netInput';
import { residentFallNet, shardFallFloor } from './standalone/fallFloor';
import { installPersonalLoot, personalCoinTable, personalItemTable } from '@wildshard/engine/game/loot/personal';
import { installRoomRespawn } from '@wildshard/engine/game/roomRespawn';
import type { GrappleTickContext } from '@wildshard/engine/game/grapple/native';
import { serverPlaces } from '@wildshard/engine/game/quest/serverPlaces';
import type { PlaceArea } from '@wildshard/engine/quest/lastPlace';
import { createSimSnapshotSerializer, admitSimSnapshotBytes, checkSimSnapshotWire, decodeSimSnapshotBytes, snapshotSimHostBytes, type SimSnapshot, type SimSnapshotBytes } from '@wildshard/engine/sim/snapshot';
import { restoreSimHost } from '@wildshard/engine/sim/restore';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { MAX_TICK_SNAPSHOT_CHARS, simPlayerCommand, TickCommandSchema, type HeadlessCommand, type HeadlessEffect } from '../../shared/host/tickProtocol';
import type { TickWorkerAdapter } from './tickWorkerLoop';
import type { ShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';
import { prepareProductRuntimePlan } from '@wildshard/engine/game/shardfile/nativePlan';
import { holdPageState, type RuntimeStateValue } from '@wildshard/engine/game/shardfile/runtimeState';
import type { NativeAssemblyPorts } from '@wildshard/engine/game/shardfile/nativeAssemblyInput';

/** The same admitted bytes and native physics implementation used by the ordinary headless worker. */
export interface HeadlessRuntimePreparation { shard: Shardfile; assets: ReadonlyMap<string, Uint8Array>; rapier: Rapier; readonly product: ShardProduct }
/** Build workers carry verified native sections before any output exists.
 * Existing native callers may instead supply or explicitly load their built product. */
export type HeadlessRuntimeInput = Omit<HeadlessRuntimePreparation, 'product'> & { readonly product?: ShardProduct; readonly sections?: ReadonlyMap<string, unknown> };
/** Current tick inputs and buffered effects; only a completed tick publishes them to the parent. */
/** What a page's save held, for a world's first boot: its quest flags and its declared fields, up before its fights install. */
export interface PageProgress { readonly flags: readonly string[]; readonly state: ReadonlyMap<string, RuntimeStateValue> }
export interface HeadlessRuntimeInstallation {
  readonly combat?: NativeCombatFrame;
  /** A net room's world, which also runs the fights a tape leaves out. */
  readonly room?: boolean;
  restoring: boolean;
  /** Strictly decoded continuation; reinstall its dynamic actor roster before native restore. Never step here. */
  snapshot?: Readonly<SimSnapshot | SimSnapshotBytes>;
  commands: () => readonly HeadlessCommand[];
  /** Another player's commands this tick. */
  playerCommands?: (id: string) => readonly HeadlessCommand[];
  emit: (effect: HeadlessEffect) => void;
}
/** Tick readers borrow the current admitted tape; no input state or simulation clock is retained. */
export interface HeadlessCommandPorts {
  readonly ledger: ReturnType<typeof ledgerPorts>;
  readonly shots: () => readonly string[];
  readonly heavy: () => NonNullable<Extract<HeadlessCommand, { kind: 'player' }>['heavy']> | null;
  readonly scripts: (ids?: readonly string[]) => () => readonly Extract<HeadlessCommand, { kind: 'script' }>[];
  readonly lastScript: <T extends number | null>(id: string, fallback: T) => number | T;
  readonly melee: () => NativeSweptMeleeInput;
  readonly walk: (speed: number) => { x: number; z: number };
}
/** Each of a body's feet coordinates is a finite number. */
function finitePoint(point: { readonly x: number; readonly y: number; readonly z: number }): boolean { return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z); }

/** Bind existing tick commands and ledger effects once at installation. Shots keep every attack; heavy picks the first
 * held command; melee/walk take the last player command, including an empty release. Script values use the last match.
 * Readers resample the current tape on every call, refuse overflow, and preserve tape order. Filtered lists and melee
 * input are borrowed scratch values, consumed immediately by the native owner rather than saved between ticks. */
export function bindHeadlessCommands(context: Pick<HeadlessRuntimeInstallation, 'commands' | 'emit'>, host?: SimHost): HeadlessCommandPorts {
  const commands = (): readonly HeadlessCommand[] => {
    const tape = context.commands();
    if (tape.length > 1024) throw new RangeError('Tick commands exceed the protocol allowance');
    return tape;
  };
  const player = (): Extract<HeadlessCommand, { kind: 'player' }> | undefined => {
    let last: Extract<HeadlessCommand, { kind: 'player' }> | undefined;
    for (const command of commands()) if (command.kind === 'player') last = command;
    return last;
  };
  const input: { attack: string | null; heavy: boolean; heavyTarget: string | null; swing: boolean } = { attack: null, heavy: false, heavyTarget: null, swing: false };
  const bound: HeadlessCommandPorts = {
    ledger: ledgerPorts(context.emit),
    shots: pickCommands(commands, command => command.kind === 'player' ? command.attack?.targetId : undefined),
    heavy: () => { for (const command of commands()) if (command.kind === 'player' && command.heavy !== undefined) return command.heavy; return null; },
    scripts: ids => pickCommands(commands, command => command.kind === 'script' && (ids === undefined || ids.includes(command.actorId)) ? command : undefined),
    lastScript: <T extends number | null>(id: string, fallback: T): number | T => {
      let result: number | T = fallback;
      for (const command of commands()) if (command.kind === 'script' && command.actorId === id) result = command.value;
      return result;
    },
    melee: () => {
      const current = player(); input.attack = current?.attack?.targetId ?? null;
      input.heavy = current?.heavy !== undefined; input.heavyTarget = current?.heavy?.targetId ?? null; input.swing = current?.swing === true; return input;
    },
    walk: speed => {
      const current = player(), x = current?.moveX ?? 0, z = current?.moveZ ?? 0, length = Math.hypot(x, z), scale = length > 1 ? speed / length : speed;
      return { x: x * scale, z: z * scale };
    },
  };
  if (host !== undefined) registerNativeQuestInputs(host, { scripts: bound.scripts(), walk: bound.walk, ledger: bound.ledger });
  return bound;
}

/** A renderer-free native runtime. Install is synchronous and registers every mutable controller via host.onStep.
 * Restore calls install before applying the complete native snapshot. It must not step or award anything at install.
 * Optional entry walks remain independent of the live headless simulation.
 */
export interface HeadlessRuntimePlan {
  level: SimLevel;
  ports?: Pick<SimHostPorts, 'ground' | 'heightAt' | 'groundResolution'>;
  install: (host: SimHost, context: HeadlessRuntimeInstallation) => void;
  proveEntries?: (host: SimHost) => { lanes: number; steps: number; liftRides?: number; liftCalls?: number; portalTransfers?: number };
  /** The product's `economy/loot` rows, where a room's personal rolls read their tables. */
  economy?: unknown;
}
/** Direct typed legacy/proof factory contract; the public worker accepts only admitted data plans. */
export type PrepareHeadlessRuntime = (context: HeadlessRuntimePreparation) => HeadlessRuntimePlan | Promise<HeadlessRuntimePlan>;

/**
 * One owned, renderer-free native world: the admitted data plan installed into one native host. The worker's
 * tick adapter (`createTrustedHeadlessAdapter`) and the grid's server-side admission (a `GridSimulation` `load` port,
 * `test/proof/<slug>/grid-ready.mjs`) both compose exactly this, so an admitted region runs the same runtime, controllers
 * and continuation as the worker.
 * - `host` is owned and stepped by its owner (the worker's `step`, or `GridSimulation.step` while the region is current);
 *   it is never embedded and owns its player motor until a grid detaches it.
 * - `lend(commands)` hands the runtime the coming tick's tick-protocol commands (`HeadlessRuntimeInstallation.commands`)
 *   and opens a fresh effect buffer; `effects` reads what the runtime emitted since that lend.
 * - `step(commands)` is the worker's fenced tick: lend, the last `player` command drives the host, and a nonfinite body
 *   refuses the tick.
 */
export interface TrustedHeadlessResident {
  readonly host: SimHost;
  lend: (commands: readonly HeadlessCommand[]) => void;
  readonly effects: readonly HeadlessEffect[];
  /** File a fact from inside a tick, for an owner a room adds on top of this world. */
  readonly fact: (name: string, entity: string) => void;
  /** One tick: `commands` for the lead player and the systems bound to it, `others` for the room's other players. */
  step: (commands: readonly HeadlessCommand[], others?: ReadonlyMap<string, NetCommand>, acts?: ReadonlyMap<string, readonly NetTickAct[]>) => void;
  proveEntries: () => ReturnType<NonNullable<HeadlessRuntimePlan['proveEntries']>>;
  dispose: () => void;
}
/** One tick command as the taming owner reads it. */
function tamingCommand(command: HeadlessCommand): ReturnType<ReturnType<NativeAssemblyPorts<HeadlessRuntimeInstallation>['tamingCommands']>>[number] {
  if (command.kind === 'script') return command;
  if (command.kind !== 'player') return { kind: 'action' };
  return command.steer === undefined ? { kind: 'player' } : { kind: 'player', steer: command.steer };
}
/** One tick command as a claw reads it. */
function grappleCommand(command: HeadlessCommand): ReturnType<GrappleTickContext['commands']>[number] {
  if (command.kind === 'script') return command;
  return command.kind === 'player' && command.jump !== undefined ? { kind: command.kind, jump: command.jump } : { kind: command.kind };
}
/** J105: a shard whose kills pay coins or items pays a room's players each their own roll. */
function installRoomLoot(host: SimHost, economy: unknown, context: HeadlessRuntimeInstallation): void {
  const coins = personalCoinTable(economy), items = personalItemTable(economy);
  if (coins !== null || items !== null) installPersonalLoot(host, { coins, alone: context.room === true, ...(items === null ? {} : { items }), grant: (player, amount) => { context.emit({ kind: 'coins', amount, actorId: player }); },
    grantItem: (player, item, count) => { context.emit({ kind: 'item', item, count, actorId: player }); } });
}
/** The tick protocol's loans to a native assembly (`@wildshard/engine/game/shardfile/nativeAssembly`). */
export function headlessAssemblyPorts(rapier: Rapier, room?: boolean): NativeAssemblyPorts<HeadlessRuntimeInstallation> {
  return { rapier, ...(room === true ? { room, arena: HEADLESS_ARENA } : {}), ledger: context => ledgerPorts(context.emit), bindCommands: bindHeadlessCommands, grantItem: context => (player, item, count) => { context.emit({ kind: 'item', item, count, actorId: player }); }, tamingCommands: context => () => context.commands().map(tamingCommand),
    grappleTick: context => ({ emit: context.emit, commands: () => context.commands().map(grappleCommand), commandsOf: id => context.playerCommands?.(id).map(grappleCommand) ?? [] }),
    heldTick: context => ({ commands: context.commands, commandsOf: id => context.playerCommands?.(id) ?? [] }) };
}
/** Resolve only the admitted native data plan. Missing declarations never
 * fall back to a shard source path; product and level identities must agree. */
export async function prepareNativeRuntime(provided: HeadlessRuntimeInput, room?: boolean): Promise<HeadlessRuntimePlan> {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(provided.shard.identity.slug)) throw new Error('Invalid native product identity');
  await prepareAssetDecoders();
  // NL5: rope decks come from the product's `client/plan`; a sections-only input (a data shard) has none to build
  let plan: HeadlessRuntimePlan, source = provided.shard, places: readonly PlaceArea[] = [], decks = provided.product;
  if (provided.sections !== undefined) {
    const declaration = parseNativeRuntimePlan(provided.sections.get('sim/runtime-plan'));
    plan = await prepareRuntimePlan(source, provided.assets, declaration.baked, declaration.recipe, provided.sections);
    plan = { ...plan, economy: provided.sections.get('economy/loot') };
  } else {
    let product = provided.product;
    if (product === undefined) {
      const { loadHeadlessProduct } = await import('./headlessProduct');
      product = await loadHeadlessProduct(`out/${provided.shard.identity.slug}`);
    }
    const { slug: actualIdentity } = product, { slug: expectedIdentity } = provided.shard.identity;
    if (actualIdentity !== expectedIdentity || product.revision !== provided.shard.identity.revision) throw new Error('Native product and trusted identity differ');
    source = product.shardfile; decks = product;
    plan = await prepareProductRuntimePlan(product, provided.assets, headlessAssemblyPorts(provided.rapier, room));
    if (product.has('economy/loot')) plan = { ...plan, economy: product.section('economy/loot') };
    places = await serverPlaces(product);
  }
  const identity = { id: source.identity.slug, seed: source.identity.seed };
  if (plan.level.id !== identity.id || plan.level.seed !== identity.seed) throw new Error('Trusted runtime simulation identity mismatch');
  return { ...plan, install: (host, context) => {
    installRoomRespawn(host, places);
    installRopeDecks(host, decks, context.restoring); // NL5: the planks the page stands on
    installCableModes(host.scope, source.modes?.traverse ?? [], host.flags).bindNative(host);
    const carried = source.runtime?.binds?.includes('movers') === true || hasDeclaredClientPage(source)
      ? source.movers.filter(row => row.carry !== undefined) : [];
    if (carried.length > 0) {
      let motion: MoverRuntime | null = null;
      host.onStep('movers.commands', () => {
        if (motion === null) throw new Error('Missing installed mover owner');
        for (const command of context.commands()) if (command.kind === 'script' && carried.some(row => row.id === command.actorId)) {
          if (command.value !== 1 && command.value !== 2) throw new Error('Invalid mover ride command');
          motion.command(command.actorId, command.value, command.playerId);
        }
      });
      motion = new MoverScriptDriver(carried, host).install(host, { content: { identity: source.identity,
        sim: { ...source.sim, bindings: [] }, state: source.state }, assets: new Map(),
        rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } },
      { id: 'movers.carried', restoring: context.restoring, restoreFlags: new Set(host.flags.all), drive: true });
    }
    plan.install(host, context);
  } };
}
/** Install the selected plan into one fresh or strictly restored native host.
 * A failed install disposes its world; installation may emit no gameplay effects. */
export async function createTrustedHeadlessResident(preparation: HeadlessRuntimeInput, snapshot?: string | Readonly<SimSnapshot | SimSnapshotBytes>, world?: { readonly room?: boolean; readonly near?: NearColliders; readonly page?: PageProgress }): Promise<TrustedHeadlessResident> {
  // The roster rolls its herds while this installs, so a room opened afterwards is too late: a save from a native-Math boot
  // would hold recipes its restore on the portable table can't reproduce.
  installPortableMath();
  const plan = await prepareNativeRuntime(preparation, world?.room);
  let commands: readonly HeadlessCommand[] = [], effects: HeadlessEffect[] = [];
  // An in-memory continuation needs the same strict admission and detached
  // ownership, without encoding and immediately decoding a transport string.
  const saved = snapshot === undefined ? undefined : typeof snapshot === 'string' ? decodeSimSnapshotBytes(snapshot) : admitSimSnapshotBytes(snapshot);
  const combat = createNativeCombatFrame();
  const otherCommands = new Map<string, readonly HeadlessCommand[]>();
  const context: HeadlessRuntimeInstallation = { combat, ...(world?.room === true ? { room: true } : {}), restoring: saved !== undefined, ...(saved === undefined ? {} : { snapshot: saved }), commands: () => commands, playerCommands: id => otherCommands.get(id) ?? [], emit: effect => { effects.push(effect); } };
  const ports = { ...plan.ports, rapier: preparation.rapier };
  let installing: SimHost | undefined;
  let host: SimHost;
  try {
    if (saved === undefined) { installing = createSimHost(plan.level, ports); if (world?.near !== undefined) { installing.physics.near = world.near; world.near.attach(installing.physics); } if (world?.page !== undefined) { for (const flag of world.page.flags) installing.flags.set(flag); holdPageState(installing, world.page.state); } plan.install(installing, context); host = installing; }
    else host = restoreSimHost(plan.level, ports, saved, fresh => {
      installing = fresh; if (ports.heightAt !== undefined) fresh.setHeightQuery(ports.heightAt); plan.install(fresh, context);
    });
    if (effects.length > 0) throw new Error('Trusted runtime emitted gameplay effects during installation');
    if (saved !== undefined && world?.near !== undefined) { host.physics.near = world.near; world.near.attach(host.physics); }
  } catch (error) { installing?.dispose(); throw error; }
  if (plan.economy !== undefined) installRoomLoot(host, plan.economy, context);
  const lead = leadPlayer(host);
  // ENG-18: a room catches its seats' falls itself (cellWorld's FallFloor); a resident alone catches its own, or nobody does.
  const caught = world?.room === true ? null : residentFallNet(host, shardFallFloor(preparation.shard.manifest?.bounds?.floor), host.level.player.at);
  const routes = actRoutes(host), held = routes.launcher;
  routes.launcher = (slot, reload, fire) => launcherTakes(nativeRangedItem(host, slot)?.kind, reload, fire) || held?.(slot, reload, fire) === true;
  const lend = (input: readonly HeadlessCommand[]): void => {
    validateHeadlessCommandOwners(host,input);
    fillNativeCombatFrame(combat, input); commands = input; effects = []; };
  /** Every other player's weapons read their own frame: a player who sent nothing this tick has let go of everything. */
  const lendOthers = (others: ReadonlyMap<string, NetCommand> | undefined, acts: ReadonlyMap<string, readonly NetTickAct[]> | undefined): void => {
    otherCommands.clear();
    if (host.players.size === 1) { combat.others.clear(); return; }
    for (const id of combat.others.keys()) if (!host.players.has(id)) combat.others.delete(id);
    for (const id of host.players.keys()) {
      if (id === lead.id) continue;
      const input = netTickCommands(others?.get(id) ?? null, acts?.get(id) ?? [], actRoutes(host));
      otherCommands.set(id, input); fillNativeCombatFrame(otherCombatFrame(combat, id), input);
    }
  };
  return {
    host, lend, fact: ledgerPorts(context.emit).fact,
    get effects() { return effects; },
    step: (input, others, acts) => {
      const interacts = acts === undefined ? [] : [...acts].flatMap(([id, list]) => netInteractCommands(actRoutes(host), list, id));
      lend(interacts.length === 0 ? input : [...input, ...interacts]); lendOthers(others, acts);
      for (const [id, list] of acts ?? []) netRide(actRoutes(host), id, undefined, list);
      for (const [id, command] of others ?? []) netRide(actRoutes(host), id, command, []);
      const tick = new Map<string, SimTickCommand>(others);
      for (const command of input) if (command.kind === 'player') tick.set(lead.id, simPlayerCommand(command));
      host.step(tick);
      caught?.();
      // MMO-PLAN MP1.2: the same check every tick, without building arrays for it.
      for (const body of host.players.values()) if (!finitePoint(body.position)) throw new Error('Nonfinite trusted simulation state');
      for (const body of host.entities.values()) if (!finitePoint(body.position)) throw new Error('Nonfinite trusted simulation state');
    },
    proveEntries: () => {
      if (plan.proveEntries === undefined) throw new Error('Trusted runtime has no entry proof');
      return plan.proveEntries(host);
    },
    dispose: () => { host.dispose(); },
  };
}
/** Worker-side composition only: owns one trusted resident (its real SimHost, native continuation and scoped installers). */
export async function createTrustedHeadlessAdapter(preparation: HeadlessRuntimeInput, snapshot?: string): Promise<TickWorkerAdapter> {
  const resident = await createTrustedHeadlessResident(preparation, snapshot), { host } = resident;
  const tape=createTrustedHeadlessTape(host,input=>resident.step(input),()=>resident.effects);
  const serializer=createSimSnapshotSerializer();
  return {
    step: input => { resident.step(input); },
    observe: () => {
      checkSimSnapshotWire(snapshotSimHostBytes(host), MAX_TICK_SNAPSHOT_CHARS);
      return { tick: host.state.tick, effects: [...resident.effects] };
    },
    verbTape:tape,
    journey: plan => runHeadlessJourney(host,input=>resident.step(input),plan),
    commit: () => ({ tick: host.state.tick, snapshot: serializer.serialize(snapshotSimHostBytes(host)), effects: [...resident.effects] }),
    finish: () => ({ ticks: host.state.tick, lanes: 0, steps: 0 }),
    dispose: () => { try { resident.dispose(); } finally { serializer.dispose(); } },
  };
}

/** Bolts take every launcher input; a lever gun's cycle only a reload. */
function launcherTakes(kind: NativeRangedItem['kind'] | undefined, reload: boolean, fire: boolean): boolean { return kind === 'bolt' || (kind === 'cycle' && reload && !fire); }

/** Validate command authority before any tick input or effect buffer changes.
 * An arbitrary slot cannot install a weapon, bypass its loadout or mutate ammo. */
export function validateHeadlessCommandOwners(host:SimHost,commands:readonly HeadlessCommand[]):void {
  if(commands.some(command=>command.kind==='interact'))throw new Error('Authored interaction commands require the data-only owner');
  for(const command of commands)if(command.kind==='launcher'){
    v.assert(TickCommandSchema,command);
    if(actRoutes(host).launcher?.(command.slot,command.reload===true,command.fire===true)===true)continue;
    if(!launcherTakes(readNativeRangedItem(host,command.slot).kind,command.reload===true,command.fire===true))throw new Error('Launcher input requires an installed bolt owner');
  }
}

/** Fill the borrowed combat frame before the tick. All attacks retain tape order; held ranged input uses the first
 * hold, melee and movement use the last player command (including release), script values use the last matching row. */
export function fillNativeCombatFrame(frame: NativeCombatFrame, commands: readonly HeadlessCommand[]): void {
  if (commands.length > 1024) throw new RangeError('Tick commands exceed the protocol allowance');
  frame.launchers.length=0; frame.attacks.length = 0; frame.heavy = null; frame.scripts.clear();
  frame.moveX = 0; frame.moveZ = 0; frame.yaw = 0; frame.pitch = 0;
  frame.melee.attack = null; frame.melee.heavy = false; frame.melee.heavyTarget = null; frame.melee.swing = false; frame.melee.pitch = null; frame.melee.sprint = false; frame.melee.seq = 0; frame.seq = 0; frame.melee.viewTick = 0; frame.viewTick = 0;
  for (const command of commands) {
    if (command.kind === 'script') frame.scripts.set(command.actorId, command.value);
    if(command.kind==='launcher')frame.launchers.push({slot:command.slot,ads:command.ads,pitch:command.pitch,
      ...(command.fire===undefined?{}:{fire:command.fire}),...(command.reload===undefined?{}:{reload:command.reload})});
    if (command.kind !== 'player') continue;
    if (command.attack !== undefined) frame.attacks.push(command.attack.targetId);
    if (frame.heavy === null && command.heavy !== undefined) frame.heavy = command.heavy;
    frame.moveX = command.moveX; frame.moveZ = command.moveZ; frame.yaw = command.yaw; frame.pitch = command.pitch ?? 0;
    frame.melee.attack = command.attack?.targetId ?? null; frame.melee.heavy = command.heavy !== undefined;
    frame.melee.heavyTarget = command.heavy?.targetId ?? null; frame.melee.swing = command.swing === true;
    frame.melee.pitch = command.pitch ?? null; frame.melee.sprint = command.sprint === true; frame.melee.seq = frame.seq = command.seq ?? 0;
    frame.melee.viewTick = frame.viewTick = command.viewTick ?? 0;
  }
}
