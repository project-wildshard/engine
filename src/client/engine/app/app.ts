import { loadRig } from '../anim/rig';
import { AnimMachine, type AnimService } from '../anim/machine';
import { InputService } from '../input/InputService';
import type { EquipmentHost } from '../combat/view/EquipmentHost';
import type { EquipmentService } from '../combat/EquipmentService';
import { saves } from '../../../shared/engine/saves/runtime';
import { RngService } from '../../../shared/engine/core/rng';
import type { Scene } from 'three';
import type { Game } from '../core/Game';
import type { Physics } from '../../../shared/engine/physics/Physics';
import type { Bodies } from '../../../shared/engine/physics/bodies';
import type { Navmesh } from '../../../shared/engine/physics/navmesh';
import type { DayCycleClock } from '../../../shared/engine/world/dayCycle';
import { WaterBodies } from '../../../shared/engine/world/water/body';
import type { WorldRegistry } from '../world/registry';
import type { AimTarget } from '../player/AimTargets';
import type { Audio } from '../audio/Audio';
import { AppDebug, resolveGrade } from './services';
import { AppUi } from './ui';
import { TickScheduler } from '../../../shared/engine/app/scheduler';
import { Events } from '../../../shared/engine/events/events';
import { GameClock, diagnosticNow } from '../../../shared/engine/core/clock';
import { ScopedCpuMeter } from '../core/scopedCpu';
import { AssetService } from './assets';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner, withOwnerCall } from '../../../shared/engine/app/ownership';
import { PHASES, sortSystems, type AppState, type Phase, type SystemSpec } from './systems';
import { LevelLoader, type LevelDriver } from '../level/load';
import { LevelRegistrations } from '../level/registrations';
import type { LevelAdapters, LevelHooks } from '../../../server/engine/level/context';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { CombatPipeline } from '../../../shared/engine/combat/pipeline';
import { AggressionService } from '../../../shared/engine/ai/director';
import { EncounterRegistry } from '../../../shared/engine/ai/encounters';
import { SpeciesService } from '../entities/species/look';
import type { PlayerHealth } from '../../../shared/engine/combat/health';
import type { EffectService } from '../../../shared/engine/combat/effects/EffectService';

interface StateHook { state: AppState; run: () => void }
export type SystemsByPhase = Readonly<Record<Phase, readonly SystemSpec[]>>;
export interface TrampleField {
  push: (x: number, z: number, radius: number, strength?: number, vx?: number, vz?: number) => void;
}

class AppWorld {
  private readonly readClock: () => DayCycleClock | null;
  private readonly readTrample: () => TrampleField | null;
  constructor(readClock: () => DayCycleClock | null, readTrample: () => TrampleField | null) {
    this.readClock = readClock; this.readTrample = readTrample;
  }
  get dayCycle(): DayCycleClock | null { return this.readClock(); }
  get trample(): TrampleField | null { return this.readTrample(); }
  /** the level's water bodies (the sea on an open-water level; src/shared/engine/world/water/body.ts) */
  private readonly homeWater = new WaterBodies();
  private readonly waterFrames: { water: WaterBodies }[] = [];
  get water(): WaterBodies { return this.waterFrames.at(-1)?.water ?? this.homeWater; }
  /** Bind retained regional water without removing any home water registrations. */
  bindWater(water: WaterBodies): () => void {
    const entry = { water }; this.waterFrames.push(entry);
    return () => { const index = this.waterFrames.indexOf(entry); if (index !== -1) this.waterFrames.splice(index, 1); };
  }
}

export class App {
  params: URLSearchParams = new URLSearchParams();
  private currentState: AppState = 'boot';
  private systems = new Map<string, SystemSpec>();
  private readonly systemScopes = new Map<string, Scope>();
  private enters = new Set<StateHook>();
  private exits = new Set<StateHook>();
  private transitioning = false;
  private transitions: AppState[] = [];
  readonly stateHistory: AppState[] = ['boot'];
  readonly events: Events;
  readonly combat: CombatPipeline;
  readonly aggression: AggressionService;
  readonly encounters: EncounterRegistry = new EncounterRegistry(() => this.levelScope);
  readonly species: SpeciesService = new SpeciesService(() => this.levelScope);
  private readonly equipmentByLevel = new WeakMap<Scope, EquipmentService>();
  get equipment(): EquipmentService | null { return this.levelScope === null ? null : this.equipmentByLevel.get(this.levelScope) ?? null; }
  registerEquipment(equipment: EquipmentService, scope: Scope): void {
    this.equipmentByLevel.set(scope, equipment);
    scope.onDispose(() => { this.equipmentByLevel.delete(scope); });
  }
  private readonly effectsByLevel = new WeakMap<Scope, EffectService>();
  get effects(): EffectService | null { return this.levelScope === null ? null : this.effectsByLevel.get(this.levelScope) ?? null; }
  registerEffects(effects: EffectService, scope: Scope): void {
    this.effectsByLevel.set(scope, effects);
    // Registered before plugin play systems; timed statuses expire before encounter legs are sampled.
    this.addSystem({ id: 'engine.effects', phase: 'update', run: (dt) => { effects.update(dt); } }, scope);
    scope.onDispose(() => { this.effectsByLevel.delete(scope); });
  }
  private readonly players = new WeakMap<Scope, PlayerHealth>();
  get player(): PlayerHealth | null { return this.levelScope === null ? null : this.players.get(this.levelScope) ?? null; }
  registerPlayer(player: PlayerHealth, scope: Scope): void {
    this.players.set(scope, player);
    scope.onDispose(() => { this.players.delete(scope); });
  }
  /** Offline benchmarks enable this; trusted content registration alone chooses the charged owner. */
  readonly cpu: ScopedCpuMeter = new ScopedCpuMeter();
  readonly input: InputService = new InputService(() => this.clock.now * 1000);
  private readonly equipmentHosts = new WeakMap<Scope, EquipmentHost>();
  get equipmentHost(): EquipmentHost | null { return this.levelScope === null ? null : this.equipmentHosts.get(this.levelScope) ?? null; }
  registerEquipmentHost(host: EquipmentHost, scope: Scope): void {
    this.equipmentHosts.set(scope, host); scope.onDispose(() => { this.equipmentHosts.delete(scope); this.input.clear(); });
  }
  /** Lend the current player's services to an entered level frame, without constructing a second player or effect loop. */
  bindPlayerServices(source: Scope, entered: Scope): void {
    const destination = this.levelScope;
    if (destination === null || source.disposed || entered.disposed || destination.disposed) throw new Error('Player services require live level frames');
    const lend = <T>(services: WeakMap<Scope, T>): void => {
      const value = services.get(source), previous = services.get(destination);
      if (value === undefined) return;
      services.set(destination, value);
      entered.onDispose(() => {
        if (services.get(destination) !== value) return;
        if (previous === undefined) services.delete(destination); else services.set(destination, previous);
      });
    };
    lend(this.players); lend(this.effectsByLevel); lend(this.equipmentHosts);
  }
  readonly engineScope: Scope = new Scope('engine');
  levelScope: Scope | null = null;
  private sorted: SystemsByPhase | null = null;
  readonly clock: GameClock = new GameClock();
  readonly rng: RngService = new RngService();
  readonly assets: InstanceType<typeof AssetService> = new AssetService();
  readonly anim: AnimService = { load: loadRig, machine: (def, rig, scope) => new AnimMachine(def, rig, scope) };
  scene: Scene | null = null;
  render: Game | null = null;
  audio: Audio | null = null;
  readonly levelRegistrations: LevelRegistrations = new LevelRegistrations();
  private readonly levelLoader = new LevelLoader(this);
  levelDriver: LevelDriver | null = null;
  levelAdapters: LevelAdapters = {};
  loadLevel(spec: LevelSpec, hooks: LevelHooks): Promise<void> {
    if (this.levelDriver === null) return Promise.reject(new Error('Level boot driver is not installed'));
    return this.levelLoader.load(spec, hooks, this.levelDriver, this.levelAdapters);
  }
  unloadLevel(): Promise<void> {
    try {
      if (this.levelLoader.unload()) return Promise.resolve();
      if (!this.render) throw new Error('Render service is not installed');
      this.render.unloadLevel();
      return Promise.resolve();
    } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error), { cause: error })); }
  }
  physics: Physics | null = null;
  bodies: Bodies | null = null;
  navmesh: Navmesh | null = null;
  navmeshId: string | null = null;
  private readonly clocks = new WeakMap<Scope, DayCycleClock>();
  private readonly trampleFields = new WeakMap<Scope, TrampleField>();
  readonly world: AppWorld = new AppWorld(() => this.dayCycle, () => this.levelScope === null ? null : this.trampleFields.get(this.levelScope) ?? null);
  registerTrample(field: TrampleField, scope: Scope): void {
    this.trampleFields.set(scope, field);
    scope.onDispose(() => { this.trampleFields.delete(scope); });
  }
  /** the entered clocks over the level's, newest last (`enterDayCycle`) */
  private readonly enteredClocks: { readonly read: () => DayCycleClock | null }[] = [];
  get dayCycle(): DayCycleClock | null {
    for (let i = this.enteredClocks.length - 1; i >= 0; i--) { const clock = this.enteredClocks[i]?.read() ?? null; if (clock !== null) return clock; }
    return this.levelScope === null ? null : this.clocks.get(this.levelScope) ?? null;
  }
  registerDayCycle(clock: DayCycleClock | null, scope: Scope): void {
    if (clock === null) this.clocks.delete(scope);
    else this.clocks.set(scope, clock);
    scope.onDispose(() => { this.clocks.delete(scope); });
  }
  /** While `scope` lives, the clock `read` returns (when not null) is the day cycle over the level's own: an entered region's
   *  sky drives Settings, the light presets and the day badge, and the level's clock returns as it was when the scope ends. */
  enterDayCycle(read: () => DayCycleClock | null, scope: Scope): void {
    const entry = { read };
    this.enteredClocks.push(entry);
    scope.onDispose(() => { const at = this.enteredClocks.indexOf(entry); if (at !== -1) this.enteredClocks.splice(at, 1); });
  }
  aimTargets: readonly AimTarget[] = [];
  registryValue: WorldRegistry | null = null;
  registryFactory: (() => WorldRegistry) | null = null;
  get registry(): WorldRegistry {
    if (this.registryValue) return this.registryValue;
    if (!this.registryFactory) throw new Error('Registry service is not installed');
    this.registryValue = this.registryFactory();
    return this.registryValue;
  }
  readonly gradeFor: <Grade extends object, Look extends { grade: Partial<Grade>; }>(spec: { grade: Grade; look?: Look; }) => { grade: Grade; look: Look | null; } = resolveGrade;
  readonly saves: typeof saves = saves;
  readonly debug: AppDebug = new AppDebug();
  readonly ui: AppUi = new AppUi(() => this.levelScope, () => this.clock.real * 1000);
  readonly scheduler: TickScheduler = new TickScheduler();

  constructor(events: Events = new Events()) { this.events = events; this.combat = new CombatPipeline(events, this.engineScope, () => this.physics); this.aggression = new AggressionService(events, this.engineScope); }
  get state(): AppState { return this.currentState; }

  setState(next: AppState): void {
    this.transitions.push(next);
    if (this.transitioning) return;
    this.transitioning = true;
    try {
      while (this.transitions.length > 0) {
        const target = this.transitions.shift();
        if (target === undefined || target === this.currentState) continue;
        const prev = this.currentState;
        const exits = [...this.exits];
        for (const hook of exits) if (hook.state === prev && this.exits.has(hook)) hook.run();
        this.currentState = target;
        this.stateHistory.push(target);
        // the state on <html data-ws-state>: a harness waiting on the load can stop on 'error' instead of timing out
        // (a caught boot error shows its modal while the load screen stays up; a capture waited 480 s on one, E399)
        // a node bake's stub document has no documentElement; the mirror is only for a real page
        try { if (typeof document !== 'undefined') document.documentElement.dataset['wsState'] = target; } catch { /* no DOM */ }
        this.clock.paused = target === 'paused' || target === 'title' || target === 'loading' || target === 'boot' || target === 'error';
        const enters = [...this.enters];
        for (const hook of enters) if (hook.state === target && this.enters.has(hook)) hook.run();
        this.events.emit('app.state', { prev, next: target });
      }
    } finally { this.transitioning = false; this.transitions.length = 0; }
  }
  private hook(hooks: Set<StateHook>, state: AppState, fn: () => void, scope: Scope): void {
    if (scope.disposed) return;
    const hook = { state, run: () => { withOwner(scope, fn); } };
    hooks.add(hook);
    scope.onDispose(() => { hooks.delete(hook); });
  }
  onEnter(state: AppState, fn: () => void, scope: Scope): void { this.hook(this.enters, state, fn, scope); }
  onExit(state: AppState, fn: () => void, scope: Scope): void { this.hook(this.exits, state, fn, scope); }

  /** Content callbacks use their trusted level/instance ticket; system IDs and core flags never select the allowance. */
  addContentSystem(spec: SystemSpec, scope: Scope): void {
    const ticket = this.cpu.ticket(scope);
    this.addSystem({ ...spec, run: (dt, t) => {
      if (!this.cpu.enabled || ticket === null) { spec.run(dt, t); return; }
      const started = diagnosticNow();
      try { spec.run(dt, t); } finally { this.cpu.record(ticket, diagnosticNow() - started); }
    } }, scope);
  }
  addSystem(spec: SystemSpec, scope: Scope): void {
    if (scope.disposed) return;
    if (this.systems.has(spec.id)) throw new Error(`Duplicate system id: ${spec.id}`);
    // Copy the declarative ordering so a caller cannot change the validated graph later.
    // the owner section takes the call's arguments, so a frame's run makes no closure (D2 idle heap churn)
    const call = (dt: number, t: number): void => { spec.run(dt, t); };
    const system = { ...spec, run: (dt: number, t: number) => { withOwnerCall(scope, call, dt, t); }, ...(spec.before ? { before: [...spec.before] } : {}),
      ...(spec.after ? { after: [...spec.after] } : {}) };
    this.systems.set(system.id, system);
    this.systemScopes.set(system.id, scope);
    this.sorted = null;
    try { this.systemsByPhase(); } catch (error) { this.systems.delete(system.id); this.systemScopes.delete(system.id); this.sorted = null; throw error; }
    scope.capture('systems', () => { this.systems.delete(system.id); this.systemScopes.delete(system.id); this.sorted = null; });
  }
  systemIds(scope: Scope): string[] { return [...this.systemScopes].filter(([, owner]) => owner.belongsTo(scope)).map(([id]) => id); }
  systemsByPhase(): SystemsByPhase {
    if (this.sorted) return this.sorted;
    const all = [...this.systems.values()];
    const result: Record<Phase, readonly SystemSpec[]> = {
      input: [], 'fixed.pre': [], 'fixed.step': [], 'fixed.post': [], update: [], late: [], render: [],
    };
    for (const phase of PHASES) result[phase] = sortSystems(all.filter((system) => system.phase === phase));
    this.sorted = result;
    return result;
  }
}
