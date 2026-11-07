import { bindPageHomes, bindPageBoss, spawnPageHome } from '../population/pageHomes';
import { createQuestLedger } from '../quest/ledger';
import * as v from 'valibot';
import type { Progress } from "../../../client/game/Progress";
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { ShardContext } from '../../../client/game/plugin/context';
import type { LedgerReceipt } from "../ledger";
import { Purse } from "../loot/Purse";
import type { RuntimeBoundSection } from "@wildshard/format/runtimeBinds";
import type { RuntimeActorRow, RuntimeBossRow } from "@wildshard/format/runtimeSpawns";
import type { Shardfile } from "@wildshard/format/shardSchema";
import { installRuntimeState, type RuntimeState, type RuntimeStateValue } from "../shardfile/runtimeState";

/** The runtime binds both sides read: which sections a runtime owns, its host state, ledger, coins and spawns. */

/** The sections `source` declares its runtime binds; empty for a pure-data shard. */
export function runtimeBinds(source: Pick<Shardfile, 'runtime'>): ReadonlySet<RuntimeBoundSection> {
  return new Set(source.runtime?.binds);
}

export function requireBound(source: Pick<Shardfile, 'runtime'>, section: RuntimeBoundSection): void {
  if (source.runtime === null) throw new Error(`Runtime-bound ${section} needs a trusted runtime declaration`);
  if (!runtimeBinds(source).has(section)) throw new Error(`Shardfile ${section} are not bound by its runtime (runtime.binds)`);
}

/**
 * The immutable files only a runtime-bound world section references (G227): the terrain's collider and tile files, the
 * props' tile, library, panel, far and texture files. Admission still fetches and verifies them with the product; the data
 * client's view drops them so a hybrid whose world is bound stays an empty data declaration.
 */
export function runtimeBoundWorldFiles(source: Shardfile): ReadonlySet<string> {
  const binds = runtimeBinds(source), files = new Set<string>();
  if (binds.has('terrain') && source.terrain !== null) for (const ref of [source.terrain.collider,
    ...(source.terrain.sampling === undefined ? [] : [source.terrain.sampling.file]), ...source.terrain.tiles.map((tile) => tile.file)]) files.add(ref);
  const props = source.props;
  if (binds.has('props') && props !== null) {
    for (const ref of [...props.tiles.flatMap((tile) => [tile.file, ...tile.additionalFiles ?? []]), ...props.panels.map((panel) => panel.file), ...props.models.map((model) => model.file), ...props.wholeLibrary ?? [],
      ...props.textures.flatMap((texture) => [texture.model, texture.colour]), ...(props.far === null ? [] : [props.far])]) files.add(ref);
  }
  if (binds.has('movers')) for (const row of source.movers) files.add(row.module);
  if (files.size === 0) return files;
  // a file another (unbound) declaration still names stays the data client's
  const moverModules = new Set(binds.has('movers') ? source.movers.map(row => row.module) : []);
  // Late roots schedule the same inventory; they never install a second reader.
  const unbound = { ...source, movers: binds.has('movers') ? [] : source.movers, sim: { ...source.sim, scripts: source.sim.scripts.filter(ref => !moverModules.has(ref)) }, terrain: binds.has('terrain') ? null : source.terrain, props: binds.has('props') ? null : source.props, tiles: [], files: [], critical: [], library: [], late: [], far: null };
  const text = JSON.stringify(unbound);
  let hashes = false;
  for (const ref of files) {
    if (/^[a-f0-9]{64}$/u.test(ref)) hashes = true;
    else if (text.includes(ref)) files.delete(ref);
  }
  // Hashes are fixed-width substrings: scan each hexadecimal run once instead of the descriptor per file.
  // Sliding windows preserve matches embedded in longer runs; caller-owned logical references keep includes above.
  if (hashes) for (const [run] of text.matchAll(/[a-f0-9]{64,}/gu)) {
    for (let at = 0; at <= run.length - 64; at++) files.delete(run.slice(at, at + 64));
  }
  return files;
}

function withoutDrawnProps(props: Shardfile['props']): Shardfile['props'] {
  if (props === null) return null;
  const { wholeLibrary: _wholeLibrary, ...rows } = props;
  return { ...rows, tiles: [], panels: [], models: [], far: null, textures: [] };
}

/** The source as the data client installs it: every runtime-bound section emptied, so neither installs it twice. */
export function withoutRuntimeRows(source: Shardfile): Shardfile {
  const binds = runtimeBinds(source);
  if (binds.size === 0) return source;
  if (binds.has('state') && (source.state.player.length > 0 || source.state.shared.some((field) => field.privacy !== 'host' && !(field.privacy === 'public' && field.type !== 'string' && (source.runtime?.spawns?.bosses.length ?? 0) > 0)))) {
    throw new Error('Runtime-bound state supports host fields and retained-actor numeric fields');
  }
  const world = runtimeBoundWorldFiles(source), keep = (ref: string): boolean => !world.has(ref);
  const far = source.far === null || source.far.files.every(keep) ? source.far : source.far.files.some(keep) ? { ...source.far, files: source.far.files.filter(keep) } : null;
  return { ...source,
    ...(binds.has('terrain') ? { terrain: null } : {}),
    // bound props keep their collider rows (an entry's landings are platform data, like the edges); the drawn content is the runtime's
    ...(binds.has('props') ? { props: withoutDrawnProps(source.props) } : {}),
    ...(world.size === 0 ? {} : { files: source.files.filter((file) => keep(file.hash)), critical: source.critical.filter(keep), library: source.library.filter(keep), far,
      tiles: source.tiles.flatMap((tile) => { const files = tile.files.filter(keep); return files.length === 0 ? [] : [files.length === tile.files.length ? tile : { ...tile, files }]; }) }),
    ...(binds.has('movers') ? { movers: [], sim: { ...source.sim, scripts: source.sim.scripts.filter(keep) } } : {}),
    ...(binds.has('modes') ? { modes: { traverse: [] } } : {}),
    ...(binds.has('clientChannels') ? { clientChannels: [] } : {}),
    ...(binds.has('quests') ? { quests: { flags: [], quests: [], triggers: [], dialogue: [] },
      ...(source.questNpcs === undefined ? {} : { questNpcs: [] }),
      ...(source.questHost === undefined ? {} : { questHost: null }) } : {}),
    ...(binds.has('ledger') ? { ledger: [] } : {}),
    ...(binds.has('loot') ? { rows: { ...source.rows, loot: [] } } : {}),
    ...(binds.has('items') ? { items: { version: 1, rows: [], contexts: [], loadout: { primary: null, secondary: null, tools: [] } } } : {}),
    ...(binds.has('state') ? { state: { ...source.state, shared: [], player: [] } } : {}),
  };
}

/** Bind one declared host state field; legacy scalar/JSON-string data migrates once, never written by the shard again. */
export function bindRuntimeState(ctx: Pick<ShardContext, 'app' | 'scope'>, source: Shardfile, key: string,
  legacyRead: () => RuntimeStateValue | null, instance: string = source.identity.slug): RuntimeState {
  requireBound(source, 'state');
  return installRuntimeState(ctx.app.saves, ctx.scope, source, instance, key, legacyRead);
}

/** A typed JSON record on one declared state field. Legacy reads run only at first initialization;
 * namespaces cannot escape the bound placement, and refused writes remain explicit boolean results. */
export function bindRuntimeJsonRecord<S extends v.GenericSchema>(ctx: Pick<ShardContext, 'app' | 'scope'>, source: Shardfile,
  key: string, schema: S, legacyRead: () => v.InferOutput<S>, instance: string = source.identity.slug): {
  readonly read: (namespace?: string) => v.InferOutput<S>; readonly write: (value: v.InferOutput<S>, namespace?: string) => boolean;
} {
  const field = bindRuntimeState(ctx, source, key, () => JSON.stringify(legacyRead()), instance);
  const owner = (namespace: string): void => { if (namespace !== instance) throw new Error('JSON record belongs to another instance'); };
  return { read: (namespace = instance) => {
    owner(namespace);
    const text = field.read(); if (typeof text !== 'string') throw new Error('Runtime JSON state must be a string');
    const value: unknown = JSON.parse(text); return v.parse(schema, value);
  }, write: (value, namespace = instance) => { owner(namespace); return field.write(JSON.stringify(v.parse(schema, value))); } };
}

/** Emit one declared fact for an entity; the platform ledger decides the grant. */
export interface RuntimeFacts {
  (name: string, entity: string): LedgerReceipt;
  /** Retry pending writes from this exact ledger; false refuses the runtime's durable checkpoint. */
  readonly flush: () => boolean;
  /** Read this shard's achievement from the emitting ledger, including pending state; never grants. */
  readonly achievement: (id: string) => { readonly count: number; readonly earned: boolean } | undefined;
}

/**
 * Bind the declared ledger rules for a runtime that has no simulation host: each fact is stamped tick 0 and told apart by
 * its entity, so a replayed or reloaded fact is the same fact and grants nothing twice (SF14). `instance` is the
 * first-party placement id.
 */
export function bindRuntimeLedger(ctx: Pick<ShardContext, 'app'>, source: Shardfile, instance: string): RuntimeFacts {
  requireBound(source, 'ledger');
  return createQuestLedger(ctx.app.saves, source, instance);
}

/** Project an existing runtime ledger into its caller-owned Progress view. The emitter remains the sole grant/write
 * owner. Each successful or duplicate emission refreshes once; a thrown emission does not refresh. Pending-write
 * retries and achievement reads are the exact original ports, and an absent view installs no presentation. */
export function projectRuntimeFacts(emit: RuntimeFacts, progress: Pick<Progress, 'bindLedger' | 'refreshLedger'> | undefined): RuntimeFacts & {
  /** Bind a later view or replace it; the caller can checkpoint its state before the ledger flush. */
  readonly bindProgress: (view: Pick<Progress, 'bindLedger' | 'refreshLedger'> | undefined, checkpoint?: () => boolean) => void;
} {
  let current = progress;
  const facts = Object.assign((name: string, entity: string) => {
    const receipt = emit(name, entity); current?.refreshLedger(); return receipt;
  }, { flush: emit.flush, achievement: emit.achievement, bindProgress: (view: Pick<Progress, 'bindLedger' | 'refreshLedger'> | undefined, checkpoint = emit.flush): void => {
    current = view;
    view?.bindLedger({ count: (id) => facts.achievement(id)?.count ?? 0,
      earned: (id) => facts.achievement(id)?.earned ?? false, checkpoint });
  } });
  facts.bindProgress(progress);
  return facts;
}

/** A runtime's coin port: what a declared quest or an encounter pays, in whole coins. */
export type RuntimeCoins = (share: number) => void;
/**
 * Bind the coins a runtime pays (a quest's `onComplete.coins`, a boss's reward burst) to the platform purse: the level's
 * loot purse in play, else (headless: tests, a node bake) the platform `Purse` for the shard. The runtime never writes the
 * coin save itself, as the full client's quest coin port.
 */
export function bindRuntimeCoins(ctx: Pick<ShardContext, 'manifest'>, purse: Purse | null): RuntimeCoins {
  let owner = purse;
  return (share) => { owner ??= new Purse(ctx.manifest.slug); owner.add(share); };
}

/** The declared runtime spawn rows, refused unless the runtime binds `spawns`. */
export function runtimeSpawnRows(source: Pick<Shardfile, 'runtime'>): NonNullable<NonNullable<Shardfile['runtime']>['spawns']> {
  requireBound(source, 'spawns');
  const rows = source.runtime?.spawns; if (rows === undefined) throw new Error('Runtime-bound spawns need runtime.spawns rows');
  return rows;
}
type Animals = NonNullable<NonNullable<ShardContext['game']['runtime']>['play']>['animals'];
type Animal = ReturnType<Animals['spawn']>;
/** One kept home: its declared row's place, the creature living there now and the seconds left before it refills. */
export interface RuntimeHome {
  readonly id: string; readonly kind: string; readonly x: number; readonly z: number; readonly yaw: number; readonly respawn: number;
  animal: Animal | null; wait: number;
}
/** What a runtime lends its declared homes. */
export interface RuntimeHomePorts {
  /** The keeper's update system id (the runtime's tests and captures find it by name). */
  readonly system: string;
  /** Decision-bound homes retain their declared actor ids on standalone pages and refills. */
  readonly decisionActors?: readonly string[];
  /** Each fresh body once spawned (the runtime's look on it). */
  readonly spawned?: (animal: Animal) => void;
  /** Actual homes by declared body address; the existing admitted authority owns their policy binding. */
  readonly bodyHomes?: { readonly rows: readonly { readonly id: string; readonly home: { readonly x: number; readonly y: number; readonly z: number; readonly r: number } }[];
    readonly authority: { home: (kind: string, actor: Animal, at: { readonly x: number; readonly y: number; readonly z: number; readonly r: number }) => void } | null };
  /** Ordered numeric memory holds at the original page update phase, read from the owner's existing flags. */
  readonly holds?: { readonly system: string; readonly rows: readonly { readonly home: number; readonly field: string; readonly until: string }[]; readonly flags: Pick<Flags, 'has'> | null };
  /**
   * One-shot bodies the runtime holds (`runtime.spawns.actors` and bosses whose encounter holds a body; Sky Reach): each
   * spawned once under its runtime-allocated identity, in `order` (the shipping allocation order), then `dress`ed. A
   * `late` body stands on a world floor (its spawn ray starts at `fromY`) and follows every other: standalone on the first
   * `settle` fixed step, once physics has its floor; in a retained home at once, at its exact `y` (restore runs before any
   * tick). The headless home keeper's `late` homes are the same rows.
   */
  readonly held?: { readonly order: readonly string[]; readonly settle: string; readonly dress?: (animal: NonNullable<Animal>, id: string) => void;
    readonly late?: (id: string) => { readonly fromY: number; readonly y: number } | undefined;
    /** Authored late floor placements; absent retains the callback contract. */
    readonly placements?: readonly { readonly id: string; readonly fromY: number; readonly y: number }[] };
}
/** The existing page manager allocates a home identity and replaces its retired body. */
export function spawnRuntimeHome(animals: Pick<Animals, 'spawn' | 'replace'>, home: RuntimeHome, variant: string | undefined, retained: boolean, decisionActors: readonly string[] = []): Animal {
  return spawnPageHome(animals, home, variant, retained, decisionActors);
}
/** The declared homes as kept: every home, every creature alive in one, and each held body by its row id. */
export interface RuntimeHomes { readonly homes: readonly RuntimeHome[]; readonly all: () => Animal[]; readonly held: (id: string) => Animal | null }

/**
 * Keep the declared homes (`runtime.spawns.homes`) in the runtime's play scope: one creature of the row's runtime species
 * per home, refilled `respawn` seconds after it dies. In a retained home (a grid cell) each creature carries its row's id
 * as its identity, and a refill replaces the retired body under that identity (fresh rig, health and ordinary AI state);
 * a portable cold restore that reapplies a dead body without replaying its death starts the authored delay. Standalone
 * spawns allocate ordinary identities, as before. Every body retires with the scope.
 */
export function bindRuntimeHomes(ctx: ShardContext, source: Pick<Shardfile, 'runtime'>, ports: RuntimeHomePorts): RuntimeHomes;
/** Construct the same roster in allocation order, yielding between bodies before publishing the completed keeper. */
export function bindRuntimeHomes(ctx: ShardContext, source: Pick<Shardfile, 'runtime'>, ports: RuntimeHomePorts, pause: () => Promise<void>): Promise<RuntimeHomes>;
export function bindRuntimeHomes(ctx: ShardContext, source: Pick<Shardfile, 'runtime'>, ports: RuntimeHomePorts, pause?: () => Promise<void>): RuntimeHomes | Promise<RuntimeHomes> {
  const rows = runtimeSpawnRows(source);
  return pause === undefined ? bindPageHomes(ctx, rows, ports) : bindPageHomes(ctx, rows, ports, pause);
}

/** A declared boss body (`runtime.spawns.bosses`): the runtime's encounter script spawns and retires it. */
export interface RuntimeBoss {
  readonly row: RuntimeBossRow;
  /** A fresh body: under the row's identity in a retained home, replacing `retired` (a retry) when given. */
  readonly spawn: (retired?: Animal) => Animal | null;
  readonly retire: (animal: Animal) => void;
}
/** Boss identity policy for a runtime adopting spawn data without changing its existing save identities. */
export interface RuntimeBossOptions {
  /** Default: the row id in retained homes. `runtime` keeps ordinary allocation order and runtime ids. */
  readonly identity?: 'declared' | 'runtime';
}
/** Bind one declared boss row to the runtime's animals; `spawned` dresses each fresh body. */
export function bindRuntimeBoss(ctx: ShardContext, source: Pick<Shardfile, 'runtime'>, id: string, spawned?: (animal: Animal) => void, options: RuntimeBossOptions = {}): RuntimeBoss {
  return bindPageBoss(ctx, runtimeSpawnRows(source), id, spawned, options);
}

/** A finite declared body, without home refill or encounter behaviour. Placement timing remains runtime-owned. */
export interface RuntimeActor {
  readonly row: RuntimeActorRow;
  /** The caller may lend native floor/altitude placement; identity follows the binder's policy. */
  readonly spawn: (placement?: { readonly y?: number; readonly fromY?: number }) => Animal | null;
  readonly retire: (animal: Animal) => void;
}

type BuildEquipment = NonNullable<NonNullable<ShardContext['game']['runtime']>['buildEquipment']>;
/** Existing equipment constructors run in declared order, with optional awaited
 * preparation and pauses. A single held item and a full ranged kit use one path.
 */
export function runtimeEquipment(steps: readonly {
  readonly slot: 'primary' | 'rifle' | 'secondary';
  readonly prepare?: (due: () => Promise<void> | null) => Promise<void>;
  readonly create: (...args: Parameters<BuildEquipment>) => Awaited<ReturnType<BuildEquipment>>['primary'];
}[], options: { readonly pause?: () => Promise<void>; readonly slice?: () => () => Promise<void> | null; readonly bind?: (weapons: Awaited<ReturnType<BuildEquipment>>) => void } = {}): BuildEquipment {
  if (steps.length === 0 || steps.length > 3 || !steps.some(step => step.slot === 'primary') ||
    new Set(steps.map(step => step.slot)).size !== steps.length) throw new Error('Invalid runtime equipment slots');
  return async (...args) => {
    const due = options.slice?.() ?? (() => null);
    const weapons: { primary: Awaited<ReturnType<BuildEquipment>>['primary'] | null; rifle: Awaited<ReturnType<BuildEquipment>>['rifle']; secondary: Awaited<ReturnType<BuildEquipment>>['secondary'] } = { primary: null, rifle: null, secondary: null };
    for (const [index, step] of steps.entries()) {
      if (step.prepare !== undefined) { await step.prepare(due); if (options.pause !== undefined) await options.pause(); }
      weapons[step.slot] = step.create(...args);
      if (index + 1 < steps.length && options.pause !== undefined) await options.pause();
    }
    const primary = weapons.primary;
    if (primary === null) throw new Error('Runtime equipment needs its primary');
    const built = { primary, rifle: weapons.rifle, secondary: weapons.secondary };
    options.bind?.(built); return built;
  };
}

/** JSON text with object keys sorted, so two profiles compare by value: a built product emits canonical key order */
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

/** Compare admitted native profiles by JSON value, independent of wire/schema property order. */
export function sameRuntimeProfile(left: unknown, right: unknown): boolean { return sortedJson(left) === sortedJson(right); }
