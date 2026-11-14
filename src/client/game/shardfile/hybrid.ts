import type { GridCellEvents } from '../../../shared/game/grid/cellEvents';
import { enterDeclaredAudioPhase } from '../audio/sceneDirector';
import { admittedProductClientPlan, installClientPhase, type ClientPhase } from './clientPlan';
import { bindResidentWorldScope, boundResidentWorldScope, residentWorldScope } from './hybridPresentation';
import { enterMovers, type BorrowedMoverRow } from '../plugin/moverViews';
import { ownerTask, withOwner } from '@wildshard/engine/app/ownership';
import type { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { createLevelInstallation, type LevelInstallation } from '@wildshard/engine/level/installation';
import { shardContext, type ShardContext, gridCells, gridHomeSim, pageGridInstance, type GridCellRef, ShardPlugin } from '../plugin/context';

import type { ShardRuntime } from '../../../shared/game/shard/runtime';
import { bindScopedRuntime, createScopedRuntimeBinding, type ScopedRuntimeBinding } from '../shard/scopedRuntime';
import { RetainedRuntimeHooks, installEnteredRuntimeService } from "../shard/retainedHooks";
import { enterSkyClock } from '../session/clockSettings';

import { shardfileSource } from './clientSource';
import type { ProductOptions } from './product';
import { configureLevel, selectedLevel } from '@wildshard/engine/level/selection';
import { reserveMapImage } from './mapImage';
import { browserShardfileOptions, productBase, provideHybridDeclaration } from './runtimeProduct';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import type { ShardfileClientBindings } from './client';
import type { Shardfile } from '@wildshard/format/shardSchema';

import type { RuntimeDeclaration } from '@wildshard/format/runtime';
import type { AudioData } from '@wildshard/format/audio';

async function runtimeClientPhase(ctx: ShardContext, phase: ClientPhase, resident: Scope, lifetime?: 'entered'): Promise<void> {
  if (!ctx.product.has('client/plan')) return;
  const plan = admittedProductClientPlan(ctx.product);
  await installClientPhase(ctx, plan, phase, resident, lifetime);
}

/** A finite data runtime has no source entry or hooks of its own. */
class ClientPlanRuntime extends ShardPlugin {}
function preparePageRuntime(product: ShardProduct, firstParty: boolean): new () => ShardPlugin {
  if (!firstParty || !product.has('client/plan')) throw new Error('Data resident requires its admitted client plan');
  admittedProductClientPlan(product);
  return ClientPlanRuntime;
}

/** A resident's data world stays alive when its independently scoped trusted play hooks leave. */
export interface HybridResident {
  readonly instance: string;
  readonly slug: string;
  readonly declaration: RuntimeDeclaration | null;
  /** Required actual admitted product when compiled client features own every stage. */
  readonly product?: ShardProduct;
  readonly firstParty: boolean;
  readonly scope: Scope;
  readonly runtime: ShardRuntime;
  /** Scoped render preparation can overlap the private world; gates afterWorld and drains before teardown. */
  readonly renderReady?: Promise<void>;
  /** Adapted runtimes park geometry/state while their entered services and singleton bindings leave. */
  readonly retainRuntime?: boolean;
  readonly context: (scope: Scope, runtime: ShardRuntime) => {
    context: ShardContext;
    openKit: () => void;
    closeKit: () => void;
    /** Bind reversible construction services while queued entered services remain unpublished. */
    prepareConstruction?: (context: ShardContext) => () => void;
    /** Apply entered regional bindings before any trusted world hook reads ambient engine services. */
    beforeWorld?: (context: ShardContext) => Promise<void> | void;
    /** Finish the regional shell's world stage, after trusted world and before its kit registration window. */
    afterWorld?: (context: ShardContext) => Promise<void> | void;
    /** Create actual creature/equipment/play services from kit rows before trusted play. */
    afterKit?: (context: ShardContext) => Promise<void> | void;
    /** Apply continuation only after trusted play has created its complete authored encounter herd. */
    afterPlay?: (context: ShardContext) => Promise<void> | void;
  };
}
/** Runtime activation status is separate from data residency and asynchronous module preparation. */
export interface HybridRuntimeState { readonly instance: string | null; readonly ready: boolean }
/** Entered installation timing in the page performance clock; bounded diagnostics, never a readiness signal. */
export interface HybridHookTiming {
  readonly instance: string;
  readonly hook: 'beforeWorld' | 'constructor' | 'world' | 'afterWorld' | 'kit' | 'afterKit' | 'play' | 'afterPlay' | 'activate';
  readonly start: number;
  readonly end: number;
  readonly outcome: 'done' | 'failed';
}
/** Optional presentation boundary for grid entered stages; standalone callers keep the existing staged path. */
export interface HybridRuntimeOptions { readonly pause?: (scope: Scope) => Promise<void> }
interface ActiveRuntime {
  resident: HybridResident; scope: Scope; ready: boolean;
  retained?: { slots: ScopedRuntimeBinding; hooks: RetainedRuntimeHooks };
}

/** A transitional world's static resources persist for the resident; entered gameplay hooks retain their own scope. */
/** Static-world recipe optionally binds admitted motion after each entered load, on the existing mover host. */
export interface ResidentWorldRecipe {
  readonly motion?: { readonly source: Shardfile; readonly systemId: string;
    readonly rows: readonly BorrowedMoverRow[] };
}
export class HybridResidentWorld<T> {
  private readonly builds = new WeakMap<Scope, Promise<T>>();
  private readonly recipe: ResidentWorldRecipe;
  constructor(recipe: ResidentWorldRecipe = {}) { this.recipe = recipe; }
  private async entered(context: ShardContext, pending: Promise<T>): Promise<T> {
    const value = await pending, row = this.recipe.motion;
    if (context.scope.disposed) throw new Error('Resident entered scope ended during construction');
    if (row !== undefined) {
      if (row.source.runtime?.binds?.includes('movers') !== true) throw new Error('Resident motion must be runtime-bound');
      const world = context.game.runtime?.world;
      if (world === undefined || world === null) throw new Error('Resident motion requires its world');
      enterMovers(context, world, row.source.movers, { systemId: row.systemId, bindings: row.rows }, value);
    }
    return value;
  }
  /** Reuse one asynchronous build across entries; the supplied owner outlives each entered play scope. */
  load(context: ShardContext, build: (owner: Scope) => Promise<T>): Promise<T> {
    const owner = boundResidentWorldScope(context.scope);
    if (owner === undefined || owner.disposed || context.scope.disposed) return Promise.reject(new Error('Missing live hybrid resident world'));
    const existing = this.builds.get(owner); if (existing !== undefined) return this.entered(context, existing);
    const pending = Promise.resolve().then(() => {
      if (owner.disposed) throw new Error('Hybrid resident left before world construction');
      return withOwner(owner, () => build(owner));
    }).then((value) => {
      if (owner.disposed) throw new Error('Hybrid resident left during world construction');
      return value;
    });
    this.builds.set(owner, pending);
    owner.onDispose(() => { this.builds.delete(owner); });
    void pending.catch(() => { if (this.builds.get(owner) === pending) this.builds.delete(owner); });
    return this.entered(context, pending);
  }
}

/** Reuse the ordinary registration verbs with a child owner; changing ctx.scope alone would retain parent registrations. */
export function hybridInstallation(base: ShardContext, scope: Scope, runtime: ShardRuntime): LevelInstallation & { context: ShardContext } {
  bindResidentWorldScope(scope, base.scope);
  const installation = createLevelInstallation(base.app, scope, base.app.levelAdapters, () => base.progress);
  base.root.add(installation.context.root);
  // A captured callback may register after an await, when the ambient owner has already returned to the page.
  // Keep the borrowed world live, changing only the registration owner seen through this entered context.
  const worlds = new WeakMap<NonNullable<ShardRuntime['world']>, NonNullable<ShardRuntime['world']>>();
  const captured = new Proxy(runtime, { get(target, key, receiver) {
    if (key !== 'world') { const value: unknown = Reflect.get(target, key, receiver); return value; }
    const world = target.world; if (world === null) return null;
    let facade = worlds.get(world);
    if (facade === undefined) {
      const game = new Proxy(world.game, { get(host, property, owner) {
        if (property === 'registrationScope') return scope;
        const value: unknown = Reflect.get(host, property, owner); return value;
      } });
      facade = new Proxy(world, { get(host, property, owner) {
        if (property === 'game') return game;
        const value: unknown = Reflect.get(host, property, owner); return value;
      } });
      worlds.set(world, facade);
    }
    return facade;
  } });
  return { ...installation, context: shardContext(installation.context, base.manifest, { ...base.game, runtime: captured }, base.product) };
}

/** Interior events for one catalogue resident; another cell never activates its trusted hooks. */
export interface HybridCellBinding {
  readonly instance: string;
  readonly cells: Pick<GridCellEvents, 'cell' | 'onEnter' | 'onLeave'>;
  /** Hold region gameplay while entered hooks install; admission of the runtime module is a separate fence. */
  readonly readiness?: (ready: boolean) => void;
  /** Borrowed home geometry and authored state persist; transient services use entered runtime installers. */
  readonly retainHomeRuntime?: boolean;
}

interface CustomRuntime {
  plugin: ShardPlugin;
  installation: LevelInstallation & { context: ShardContext };
  active: boolean;
  ready: boolean;
  retained?: { slots: ScopedRuntimeBinding; hooks: RetainedRuntimeHooks };
}

/** Standalone staged composition keeps the resident data plugin and trusted hooks on the existing Game boot path. */
export class HybridShardPlugin extends ShardPlugin {
  private readonly data: ShardPlugin;
  private readonly Runtime: new () => ShardPlugin;
  private custom: CustomRuntime | undefined;
  private readonly binding: HybridCellBinding | undefined;
  private generation = 0;
  constructor(data: ShardPlugin, Runtime: new () => ShardPlugin, binding?: HybridCellBinding,
    private readonly declaredAudio?: AudioData) {
    super(); this.data = data; this.Runtime = Runtime; this.binding = binding;
  }
  override async world(provided: ShardContext): Promise<void> {
    const ctx = this.declaredAudio === undefined ? provided : { ...provided, get progress() { return provided.progress; },
      game: { ...provided.game, declaredAudio: this.declaredAudio } };
    await this.data.world?.(ctx);
    if (ctx.scope.disposed) throw new Error('Hybrid world was unloaded during admission');
    if (this.binding !== undefined) {
      const binding = this.binding;
      ctx.scope.onDispose(binding.cells.onLeave((cell) => {
        if (cell.instance === binding.instance) this.leaveRuntime();
      }));
    }
    await this.runtimeWorld(ctx);
  }
  private leaveRuntime(): void {
    this.generation++;
    const custom = this.custom; if (custom === undefined) return;
    if (custom.retained === undefined || !custom.ready) { custom.installation.context.scope.dispose(); return; }
    custom.active = false; this.binding?.readiness?.(false);
    try { custom.retained.hooks.deactivate(); } finally { custom.retained.slots.deactivate(); }
  }
  private async enteredPlan(ctx: ShardContext, phase: ClientPhase): Promise<void> {
    await runtimeClientPhase(ctx, phase, residentWorldScope(ctx), 'entered');
  }
  private async runtimeWorld(ctx: ShardContext): Promise<void> {
    if (this.binding !== undefined && this.binding.cells.cell?.instance !== this.binding.instance) throw new Error('Trusted hooks require the entered cell interior');
    this.generation++;
    const existing = this.custom;
    if (existing?.retained !== undefined && existing.ready) {
      const retained = existing.retained;
      retained.slots.activate();
      try { retained.hooks.activate(); existing.active = true; }
      catch (error) { retained.slots.deactivate(); throw error; }
      return;
    }
    const parent = ctx.game.runtime; if (parent === undefined) throw new Error('Hybrid requires the normal runtime host');
    const scope = ctx.scope.child('runtime.play');
    try {
      const slots = this.binding?.retainHomeRuntime === true ? createScopedRuntimeBinding(parent, scope) : undefined;
      slots?.activate();
      const runtime = slots?.runtime ?? bindScopedRuntime(parent, scope), base = hybridInstallation(ctx, scope, runtime);
      const hooks = slots === undefined ? undefined : new RetainedRuntimeHooks(base.context);
      // R12: while entered, the runtime's own sky clock is the day cycle (a painted sky's, published on its runtime)
      if (hooks !== undefined) { const owned = hooks.context; installEnteredRuntimeService(owned, (entered) => { enterSkyClock(owned.app, [owned.scope], entered); }); }
      const installation = hooks === undefined ? base : { ...base, context: hooks.context };
      const plugin = withOwner(scope, () => new this.Runtime());
      const custom: CustomRuntime = { plugin, installation, active: true, ready: false,
        ...(slots === undefined || hooks === undefined ? {} : { retained: { slots, hooks } }),
      }; this.custom = custom;
      scope.onDispose(() => {
        if (this.custom === custom) { this.custom = undefined; this.binding?.readiness?.(false); }
      });
      this.binding?.readiness?.(false);
      await this.enteredPlan(installation.context, 'world');
      await withOwner(scope, () => plugin.world?.(installation.context));
      await this.enteredPlan(installation.context, 'world-bindings');
      if (scope.disposed) throw new Error('Hybrid runtime left during world installation');
    } catch (error) {
      try { scope.dispose(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Hybrid world installation and cleanup failed', { cause: cleanup }); }
      throw error;
    }
  }
  override async kit(ctx: ShardContext): Promise<void> {
    await this.data.kit?.(ctx);
    await this.runtimeKit();
  }
  private async runtimeKit(): Promise<void> {
    const custom = this.custom; if (custom === undefined || !custom.active) throw new Error('Hybrid runtime world is not installed');
    if (custom.retained !== undefined && custom.ready) return;
    custom.installation.openKit();
    try { await enterDeclaredAudioPhase(custom.installation.context, 'kit'); await withOwner(custom.installation.context.scope, () => custom.plugin.kit?.(custom.installation.context)); await this.enteredPlan(custom.installation.context, 'kit'); }
    finally { custom.installation.closeKit(); }
    if (custom.installation.context.scope.disposed) throw new Error('Hybrid runtime left during kit installation');
  }
  override async play(ctx: ShardContext): Promise<void> {
    await this.data.play?.(ctx);
    await this.runtimePlay();
    // The shell creates creature motors between kit and play. Release their trusted dependants before those later
    // parent registrations unwind, rather than relying on the child's early world-stage insertion order.
    ctx.scope.onDispose(() => { this.generation++; this.custom?.installation.context.scope.dispose(); });
    const binding = this.binding;
    if (binding !== undefined) ctx.scope.onDispose(binding.cells.onEnter((cell) => {
      if (cell.instance !== binding.instance || this.custom?.active === true) return;
      void this.reenter(ctx);
    }));
  }
  private async reenter(ctx: ShardContext): Promise<void> {
    const generation = this.generation + 1;
    try { await this.runtimeWorld(ctx); await this.runtimeKit(); await this.runtimePlay(); }
    catch (error) {
      if (generation !== this.generation || ctx.scope.disposed) return;
      let failure = error;
      try { this.custom?.installation.context.scope.dispose(); }
      catch (cleanup) { failure = new AggregateError([error, cleanup], 'Hybrid activation and cleanup failed'); }
      ctx.app.events.emit('fault', { source: 'hybrid.runtime', message: failure instanceof Error ? failure.message : String(failure), error: failure });
    }
  }
  private async runtimePlay(): Promise<void> {
    const custom = this.custom; if (custom === undefined || !custom.active) throw new Error('Hybrid runtime kit is not installed');
    if (custom.retained !== undefined && custom.ready) { this.binding?.readiness?.(true); return; }
    await enterDeclaredAudioPhase(custom.installation.context, 'play'); await this.enteredPlan(custom.installation.context, 'prepare-play'); await withOwner(custom.installation.context.scope, () => custom.plugin.play?.(custom.installation.context));
    await this.enteredPlan(custom.installation.context, 'play');
    if (custom.installation.context.scope.disposed) throw new Error('Hybrid runtime left during play installation');
    custom.ready = true; this.binding?.readiness?.(true);
  }
}

/** Admit declared data and trusted hooks; catalogue placement and cell activation stay in the game layer. */
export async function prepareHybridShard(product: ShardProduct, options: ProductOptions | { firstParty: true },
  bindings: Omit<ShardfileClientBindings, 'instance' | 'trustedRuntime'> & {
    /** The game adapter forwards the page owner; the shard need not read or own another service. */
    readonly residencyContext?: Pick<ShardContext, 'game' | 'scope'>;
    /** Retain an adapted borrowed home runtime across road visits; neighbours remain fenced. */
    readonly retainHomeRuntime?: boolean;
    /** First-party transition whose runtime installs every admitted world/kit/play declaration.
     * Admission and residency still run; the data client must not install a second simulation. */
    readonly stagesOwner?: 'declared' | 'runtime';
  }): Promise<ShardPlugin> {
  // Every entry passes the product already loaded before its hooks.
  const productOptions = 'base' in options ? options : browserShardfileOptions(productBase(product.slug), options.firstParty);
  const source = product.shardfile;
  if (source.runtime === null) throw new Error('Hybrid requires a compiled client-plan runtime declaration');
  provideHybridDeclaration(source);
  if (bindings.stagesOwner === 'runtime' && !options.firstParty) throw new Error('Runtime stage ownership requires a trusted first-party shard');
  const { residencyContext, retainHomeRuntime, stagesOwner, ...providedBindings } = bindings;
  const residency = residencyContext?.game.residency;
  if (residency !== undefined && providedBindings.residency !== undefined && residency !== providedBindings.residency) {
    throw new Error('Hybrid installation and bindings must share one page residency owner');
  }
  const imageOwner = providedBindings.imageOwner ?? residencyContext?.scope;
  const clientBindings = { ...providedBindings, ...(residency === undefined ? {} : { residency }),
    ...(imageOwner === undefined ? {} : { imageOwner }) };
  const gridInstance = pageGridInstance(), instance = gridInstance ?? source.identity.slug;
  // The data client announces only when it will actually build a simulation. An empty trusted transition runs its
  // legacy gameplay directly and has no handoff; promising one would hold the reveal until its safety ceiling.
  const onSimulationExpected = (): void => { clientBindings.onSimulationExpected?.(); if (gridInstance !== null) gridHomeSim.expect(); };
  // in a grid page the restored home simulation goes to the live grid owner (its freeze fence gates the existing driver)
  const onSimulation: ShardfileClientBindings['onSimulation'] = gridInstance === null ? clientBindings.onSimulation : (binding) => {
    clientBindings.onSimulation?.(binding);
    gridHomeSim.offer({ setActive: binding.setActive, checkpoint: binding.checkpoint, disposed: () => binding.scope.disposed,
      ...(binding.residency === undefined ? {} : { residency: binding.residency }),
    });
  };
  const { load, mapImage } = await shardfileSource(source, productOptions, { ...clientBindings, instance, trustedRuntime: true, runtimeStagesOnly: stagesOwner === 'runtime', planLifetime: 'resident', audioOwner: clientBindings.audioOwner ?? 'runtime', worldOwner: clientBindings.worldOwner ?? 'runtime', onSimulationExpected, ...(onSimulation === undefined ? {} : { onSimulation }) })
    .then(data => ({ load: data.load, mapImage: data.minimap?.image }));
  if (load === undefined) throw new Error('Missing admitted hybrid data plugin');
  const Runtime = preparePageRuntime(product, productOptions.firstParty);
  const installed = await load().then(({ default: Data }) => new Data());
  const mapped: ShardPlugin = source.map === undefined ? installed : {
    async world(ctx) {
      const allocator = clientBindings.residency?.allocator ?? clientBindings.allocator;
      if (allocator === undefined) throw new Error('Hybrid map requires its page allocator');
      reserveMapImage(source, allocator, ctx.scope);
      const level = selectedLevel(), image = mapImage;
      if (gridInstance === null && level !== null && image !== undefined) configureLevel({ ...level, minimap: { ...level.minimap, image } });
      await installed.world?.(ctx);
    },
    kit: ctx => installed.kit?.(ctx), play: ctx => installed.play?.(ctx),
  };
  return new HybridShardPlugin(mapped, Runtime, gridInstance === null ? undefined : { instance, cells: gridCells, ...(retainHomeRuntime === undefined ? {} : { retainHomeRuntime }) }, source.audio);
}


/** Only the entered cell owns gameplay callbacks. Neighbour prefetch admits modules and data only. */
export class HybridRuntimeSession {
  private readonly residents: ReadonlyMap<string, HybridResident>;
  private readonly prepared = new Map<string, Promise<new () => ShardPlugin>>();
  private readonly retained = new Map<string, ActiveRuntime>();
  private readonly installations = new Map<string, Promise<boolean>>();
  private active: ActiveRuntime | undefined;
  private generation = 0;
  private disposed = false;
  private currentHook: Readonly<Pick<HybridHookTiming, 'instance' | 'hook' | 'start'>> | null = null;
  private readonly completedHooks: HybridHookTiming[] = [];
  constructor(residents: ReadonlyMap<string, HybridResident>, scope: Scope, private readonly options: HybridRuntimeOptions = {}) {
    this.residents = residents;
    scope.onDispose(() => {
      this.disposed = true; this.leave();
      for (const active of this.retained.values()) active.scope.dispose();
      this.retained.clear(); this.prepared.clear(); this.installations.clear();
    });
  }
  /** Module admission can run while a neighbour is frozen; no constructor or world/kit/play hook runs here. */
  prepare(instance: string): Promise<new () => ShardPlugin> {
    if (this.disposed) return Promise.reject(new Error('Hybrid session is disposed'));
    const resident = this.residents.get(instance);
    if (resident === undefined) return Promise.reject(new Error('Missing hybrid resident'));
    const prior = this.prepared.get(instance); if (prior !== undefined) return prior;
    const product = resident.product;
    if (!resident.firstParty || product === undefined || !product.has('client/plan')) return Promise.reject(new Error('Data resident requires its admitted client plan'));
    admittedProductClientPlan(product);
    const prepared = Promise.resolve(ClientPlanRuntime);
    this.prepared.set(instance, prepared);
    void prepared.catch(() => { if (this.prepared.get(instance) === prepared) this.prepared.delete(instance); });
    return prepared;
  }
  private async stage<T>(scope: Scope, instance: string, hook: HybridHookTiming['hook'], run: () => T | Promise<T>): Promise<T> {
    const current = Object.freeze({ instance, hook, start: diagnosticNow() });
    this.currentHook = current;
    let outcome: HybridHookTiming['outcome'] = 'failed';
    let value: T;
    try { value = await run(); outcome = 'done'; }
    finally {
      this.completedHooks.push(Object.freeze({ ...current, end: diagnosticNow(), outcome }));
      if (this.completedHooks.length > 32) this.completedHooks.shift();
      if (this.currentHook === current) this.currentHook = null;
    }
    if (this.options.pause !== undefined) await this.options.pause(scope);
    if (scope.disposed) throw new Error('Hybrid runtime left between entered stages');
    return value;
  }
  /** Correlate long-task intervals with the current hook and the last 32 completed hooks, including failed installs. */
  timings(): { readonly current: Readonly<Pick<HybridHookTiming, 'instance' | 'hook' | 'start'>> | null; readonly completed: readonly HybridHookTiming[] } {
    return { current: this.currentHook, completed: [...this.completedHooks] };
  }
  /** GC6: the cells whose entry is being prepared on the road (for the tour's trace) */
  preparing(): readonly string[] { return [...this.installations.keys()]; }
  /** Finish an actually requested entry before its frame transfer. Neighbours use inert prepare() only.
   * A source must leave first; entered services and parent runtime slots publish only at enter(). */
  prepareEntry(instance: string, signal?: AbortSignal): Promise<boolean> {
    if (this.disposed) return Promise.reject(new Error('Hybrid session is disposed'));
    if (this.active !== undefined) return Promise.reject(new Error('Entry preparation requires the neutral road'));
    if (signal?.aborted === true) return Promise.reject(new Error('Entry preparation was cancelled'));
    const resident = this.residents.get(instance);
    if (resident === undefined) return Promise.reject(new Error('Missing hybrid resident'));
    const prior = this.installations.get(instance); if (prior !== undefined) return prior;
    const request = this.install({ instance, slug: resident.slug }, true, signal);
    this.installations.set(instance, request);
    void request.finally(() => { if (this.installations.get(instance) === request) this.installations.delete(instance); }).catch(() => undefined);
    return request;
  }
  /** Called by the cell-interior producer, after leaving the old cell. Late hook completions cannot publish another scope. */
  async enter(cell: GridCellRef): Promise<boolean> {
    const preparing = this.installations.get(cell.instance);
    if (preparing !== undefined && !await preparing) return false;
    return this.install(cell, false);
  }
  private async install(cell: GridCellRef, preparing: boolean, signal?: AbortSignal): Promise<boolean> {
    if (this.disposed) throw new Error('Hybrid session is disposed');
    const resident = this.residents.get(cell.instance);
    if (resident === undefined) throw new Error('Missing hybrid resident');
    const { slug: identity } = resident, { slug: cellIdentity } = cell;
    if (identity !== cellIdentity) throw new Error('Hybrid cell must match its catalogue instance and shard');
    if (this.active?.resident === resident) return this.active.ready;
    if (preparing && (this.active !== undefined || resident.retainRuntime !== true)) throw new Error('Entry preparation requires a neutral retained resident');
    if (!preparing) this.leave();
    const generation = this.generation;
    let construction: (() => void) | undefined, preparingScope: Scope | undefined;
    let rendering: Promise<[PromiseSettledResult<void>]> | undefined;
    try {
      const parked = this.retained.get(cell.instance);
      if (parked !== undefined && !parked.scope.disposed && parked.retained !== undefined) {
        if (preparing) return true;
        const start = diagnosticNow(); let outcome: HybridHookTiming['outcome'] = 'failed';
        try {
          const { slots, hooks } = parked.retained;
          slots.activate();
          // sp-o4 (grid readiness): the hooks' installers (~18 ms: audio filters, bag tabs, UI, inputs) take their own frame
          // rather than the crossing's fixed step; a leave or a newer crossing meanwhile takes the slots back
          if (this.options.pause !== undefined) {
            // read after the await: the scope (and the generation) may have moved on while it waited
            const gone = (): boolean => parked.scope.disposed, stale = (): boolean => generation !== this.generation;
            try { await this.options.pause(parked.scope); }
            catch (error) { if (!gone()) slots.deactivate(); throw error; }
            if (stale() || gone()) { if (!gone()) slots.deactivate(); return false; }
          }
          try { hooks.activate(); }
          catch (error) { slots.deactivate(); throw error; }
          this.active = parked; outcome = 'done'; return true;
        } finally {
          this.completedHooks.push(Object.freeze({ instance: cell.instance, hook: 'activate', start, end: diagnosticNow(), outcome }));
          if (this.completedHooks.length > 32) this.completedHooks.shift();
        }
      }
      const renderReady = resident.renderReady;
      if (renderReady !== undefined) rendering = Promise.allSettled([renderReady]);
      const Plugin = await this.prepare(cell.instance);
      if ((!preparing && generation !== this.generation) || resident.scope.disposed || signal?.aborted === true) return false;
      // Ordinary entry keeps the original fence before any runtime aliases
      // activate. Only neutral-road private construction overlaps rendering.
      if (!preparing && renderReady !== undefined) {
        await renderReady;
        if (this.disposed || generation !== this.generation || resident.scope.disposed) return false;
      }
      const scope = resident.scope.child(`runtime:${cell.instance}`), active: ActiveRuntime = { resident, scope, ready: false };
      if (preparing) {
        preparingScope = scope;
        if (signal !== undefined) scope.listen(signal, 'abort', () => { scope.dispose(); }, { once: true });
      } else this.active = active;
      scope.onDispose(() => { if (this.active === active) this.active = undefined; if (this.retained.get(cell.instance) === active) this.retained.delete(cell.instance); });
      const slots = resident.retainRuntime === true ? createScopedRuntimeBinding(resident.runtime, scope) : undefined;
      if (!preparing) slots?.activate();
      const runtime = slots?.runtime ?? bindScopedRuntime(resident.runtime, scope), installation = resident.context(scope, runtime);
      bindResidentWorldScope(scope, resident.scope);
      const hooks = slots === undefined ? undefined : new RetainedRuntimeHooks(installation.context, { deferActivation: preparing });
      if (slots !== undefined && hooks !== undefined) active.retained = { slots, hooks };
      // R12: while entered, the cell's own sky clock is the day cycle (its region's layered sky, or a painted sky's runtime)
      if (hooks !== undefined) { const owned = hooks.context; installEnteredRuntimeService(owned, (entered) => { enterSkyClock(owned.app, [owned.scope, resident.scope], entered); }); }
      const context = hooks?.context ?? installation.context;
      const live = (): boolean => !scope.disposed && (preparing ? this.active === undefined : this.active === active && generation === this.generation);
      if (preparing) {
        if (installation.prepareConstruction === undefined) throw new Error('Entry preparation requires isolated construction bindings');
        construction = installation.prepareConstruction(context);
      }
      await this.stage(scope, cell.instance, 'beforeWorld', () => ownerTask(scope, () => installation.beforeWorld?.(context))); if (!live()) return false;
      const plugin = await this.stage(scope, cell.instance, 'constructor', () => withOwner(scope, () => new Plugin()));
      if (!live()) return false;
      await this.stage(scope, cell.instance, 'world', () => ownerTask(scope, async () => {
        await runtimeClientPhase(context, 'world', resident.scope); await plugin.world?.(context);
        await runtimeClientPhase(context, 'world-bindings', resident.scope);
      })); if (!live()) return false;
      await this.stage(scope, cell.instance, 'afterWorld', () => ownerTask(scope, async () => {
        if (renderReady !== undefined) await renderReady;
        if (!live()) throw new Error('Hybrid runtime left while preparing render tiles');
        await installation.afterWorld?.(context);
      })); if (!live()) return false;
      installation.openKit();
      try { await this.stage(scope, cell.instance, 'kit', () => ownerTask(scope, async () => {
        await enterDeclaredAudioPhase(context, 'kit'); await plugin.kit?.(context); await runtimeClientPhase(context, 'kit', resident.scope);
      })); } finally { installation.closeKit(); }
      if (!live()) return false;
      await this.stage(scope, cell.instance, 'afterKit', () => ownerTask(scope, () => installation.afterKit?.(context))); if (!live()) return false;
      await this.stage(scope, cell.instance, 'play', () => ownerTask(scope, async () => {
        await enterDeclaredAudioPhase(context, 'play'); await runtimeClientPhase(context, 'prepare-play', resident.scope); await plugin.play?.(context); await runtimeClientPhase(context, 'play', resident.scope);
      })); if (!live()) return false;
      await this.stage(scope, cell.instance, 'afterPlay', () => ownerTask(scope, () => installation.afterPlay?.(context))); if (!live()) return false;
      active.ready = true;
      if (active.retained !== undefined) this.retained.set(cell.instance, active);
      return true;
    } catch (error) {
      // Keep a world/construction failure authoritative while every started
      // render allocation finishes under its still-live resident owner.
      if (rendering !== undefined) await rendering;
      if (preparing) { preparingScope?.dispose(); throw error; }
      if (generation !== this.generation) return false;
      try { this.leave(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Hybrid activation and cleanup failed', { cause: cleanup }); }
      throw error;
    } finally {
      if (rendering !== undefined) await rendering;
      construction?.();
      if (preparingScope !== undefined && !this.retained.has(cell.instance)) preparingScope.dispose();
    }
  }
  /** Remove only play resources and runtime aliases; the admitted shardfile world, tiles and frozen simulation remain. */
  leave(): void {
    this.generation++; const active = this.active; this.active = undefined;
    if (active === undefined) return;
    if (active.retained === undefined || !active.ready) { active.scope.dispose(); return; }
    try { active.retained.hooks.deactivate(); } finally { active.retained.slots.deactivate(); }
  }
  /** Admission fences can observe whether the current inside-cell runtime finished its trusted stages. */
  state(): HybridRuntimeState { return { instance: this.active?.resident.instance ?? null, ready: this.active?.ready ?? false }; }
}
