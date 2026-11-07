import type { App } from '../app/app';
import type { Scope } from '../../../shared/engine/app/scope';
import type { StepProgress } from '../boot/plan';
import { loadingStage } from '../../../shared/engine/boot/waits';
import type { LevelAdapters, LevelContext, LevelHooks } from '../../../server/engine/level/context';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { createLevelInstallation } from './installation';

export type LevelStage = 'level.data' | 'level.world' | 'level.kit' | 'level.play' | 'finish';
export interface LevelDriver {
  /** The production driver adopts the renderer's level scope; node drivers create a fresh one. */
  scope?: () => Scope;
  progress: (stage: LevelStage) => StepProgress;
  data: (spec: LevelSpec, ctx: LevelContext) => Promise<void> | void;
  world: (spec: LevelSpec, ctx: LevelContext) => Promise<void> | void;
  kit: (spec: LevelSpec, ctx: LevelContext) => Promise<void> | void;
  loadout: (spec: LevelSpec, ctx: LevelContext) => Promise<void> | void;
  play: (spec: LevelSpec, ctx: LevelContext) => Promise<void> | void;
  finish: (spec: LevelSpec, ctx: LevelContext) => Promise<void> | void;
  dispose?: (ctx: LevelContext) => void;
}

export class LevelLoadError extends Error {
  readonly stage: LevelStage;
  constructor(stage: LevelStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.stage = stage;
    this.name = 'LevelLoadError';
    if (cause instanceof Error && cause.stack !== undefined) this.stack = cause.stack;
  }
}

interface LoadedLevel { spec: LevelSpec; scope: Scope; ctx: LevelContext; driver: LevelDriver }

/** Await hooks at their boundaries, close kit registration, and dispose every failure before it escapes. */
export class LevelLoader {
  private level: LoadedLevel | null = null;
  private loading = false;
  private managed = false;
  private readonly app: App;
  constructor(app: App) { this.app = app; }

  async load(spec: LevelSpec, hooks: LevelHooks, driver: LevelDriver, adapters: LevelAdapters): Promise<void> {
    if (this.loading || this.level !== null) throw new Error('Unload the current level before loading another');
    const scope = driver.scope?.() ?? this.app.engineScope.child(`level:${spec.id}`);
    if (scope.disposed) throw new Error('Level boot driver returned a disposed scope');
    this.loading = true;
    this.managed = true;
    let stage: LevelStage = 'level.data';
    const live = (): void => { if (scope.disposed) throw new Error('Level was unloaded during load'); };
    const installation = createLevelInstallation(this.app, scope, adapters, () => driver.progress(stage));
    const ctx = installation.context;
    this.level = { spec, scope, ctx, driver }; this.app.levelScope = scope;
    const run = async (next: LevelStage, work: () => Promise<void>): Promise<void> => {
      stage = next;
      try { live(); await loadingStage(next, work); live(); } catch (error) { throw new LevelLoadError(next, error); }
    };
    try {
      this.app.setState('loading');
      await run('level.data', async () => {
        for (const body of spec.ground.water ?? []) this.app.world.water.add(body, scope); // the level's water, known before its world builds
        await driver.data(spec, ctx);
      });
      await run('level.world', async () => { await driver.world(spec, ctx); await hooks.world?.(ctx); });
      await run('level.kit', async () => {
        await driver.kit(spec, ctx);
        installation.openKit();
        try { await hooks.kit?.(ctx); } finally { installation.closeKit(); }
        await driver.loadout(spec, ctx);
      });
      await run('level.play', async () => { await driver.play(spec, ctx); await hooks.play?.(ctx); });
      await run('finish', async () => { await driver.finish(spec, ctx); });
      this.app.events.emit('level.loaded', { id: spec.id });
    } catch (error) {
      const failures: unknown[] = [error];
      try { this.app.setState('error'); } catch (stateError) { failures.push(stateError); }
      try { this.unload(); } catch (disposeError) { failures.push(disposeError); }
      if (failures.length > 1) throw new AggregateError(failures, 'Level load and cleanup failed', { cause: error });
      throw error;
    } finally { this.loading = false; }
  }

  unload(): boolean {
    const level = this.level;
    if (level === null) return this.managed;
    this.level = null;
    try { level.driver.dispose?.(level.ctx); }
    finally {
      try { level.scope.dispose(); }
      finally {
        if (this.app.levelScope === level.scope) this.app.levelScope = null;
        this.app.events.emit('level.unloaded', { id: level.spec.id });
      }
    }
    return true;
  }
}
