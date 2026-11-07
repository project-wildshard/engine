import type { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { GridAssembly, GridPoint } from './assembly';
import type { GridLoadout } from './wallet';

/** A prepared, rollback-safe frame/view change. Commit must either finish completely or leave the source intact. */
export interface PreparedGridCrossing { commit: () => void; cancel: () => void }
/** Poll pending durability without capturing an old asynchronous snapshot; true must checkpoint the current fixed boundary. */
export type GridCheckpointResult = boolean | 'pending';
/** Destination admission runs ahead of the fixed step; local checkpoints and stow never transfer shard possessions. */
export interface GridCrossingPorts {
  prepare: (from: string | null, to: string | null) => Promise<PreparedGridCrossing>;
  ready: (instance: string | null) => boolean;
  checkpoint: (instance: string) => GridCheckpointResult;
  stow: (instance: string) => void;
  interior: (instance: string) => void;
  changed: (from: string | null, to: string | null) => void;
}
/** Observed logical frame and admission state; a blocked transition keeps the original active frame. */
export interface GridCrossingState {
  readonly current: string | null; readonly target: string | null;
  readonly phase: 'settled' | 'preparing' | 'ready' | 'blocked' | 'save-pending' | 'save-failed'; readonly issue: string | null;
}
/** Synchronous checkpoint + frame commit + changed callbacks; excludes asynchronous approach preparation. */
export interface GridCrossingTiming {
  /** Crossing demand and completed admission, distinct from prefetch and synchronous commit. */
  readonly requestedAt: number; readonly readyAt: number;
  readonly from: string | null; readonly to: string | null; readonly start: number; readonly end: number;
  /** Same-clock phase boundaries: save work, frame/motor commit, then entered-leave/disposal callbacks. */
  readonly checkpointEnd: number; readonly commitEnd: number;
}
/** Session-local crossing coordinator. No navigation, save copying, respawn or asynchronous work occurs during commit. */
export class GridCrossing {
  private current: string | null;
  private target: string | null;
  private phase: GridCrossingState['phase'] = 'settled';
  private issue: string | null = null;
  private generation = 0;
  private prepared: PreparedGridCrossing | undefined;
  private disposed = false;
  private inside: boolean | undefined;
  private readonly ports: GridCrossingPorts;
  private readonly completed: GridCrossingTiming[] = [];
  private requestedAt = 0;
  private readyAt = 0;
  constructor(current: string | null, ports: GridCrossingPorts) { this.current = current; this.target = current; this.ports = ports; }
  /** Start or supersede destination preparation without retiring the current frame. */
  request(target: string | null): void {
    if (this.disposed) throw new Error('Crossing is disposed');
    if (target?.length === 0) throw new Error('Crossing needs a stable instance');
    if (target === this.target && this.phase === 'save-failed') { this.retrySave(); return; }
    if (target === this.target && this.phase !== 'blocked') return;
    this.prepared?.cancel(); this.prepared = undefined;
    const generation = ++this.generation; this.target = target; this.issue = null;
    if (target === this.current) { this.phase = 'settled'; return; }
    this.phase = 'preparing';
    this.requestedAt = diagnosticNow();
    void this.prepare(generation, this.current, target);
  }
  private async prepare(generation: number, from: string | null, target: string | null): Promise<void> {
    try {
      const prepared = await this.ports.prepare(from, target);
      if (this.disposed || generation !== this.generation) { prepared.cancel(); return; }
      this.prepared = prepared; this.phase = 'ready'; this.readyAt = diagnosticNow();
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.phase = 'blocked'; this.issue = error instanceof Error ? error.message : String(error);
    }
  }
  /** Call once per fixed step. Border stow happens before the strip's delayed physical re-frame. */
  step(inside: boolean): boolean {
    if (this.disposed) return false;
    if (this.current !== null) {
      const activeInterior = inside && this.target === this.current;
      if (activeInterior !== this.inside) {
        if (activeInterior) this.ports.interior(this.current); else this.ports.stow(this.current);
        this.inside = activeInterior;
      }
    }
    const prepared = this.prepared;
    if ((this.phase !== 'ready' && this.phase !== 'save-pending') || prepared === undefined || !this.ports.ready(this.target)) return false;
    const from = this.current, to = this.target;
    const start = diagnosticNow();
    if (from !== null) {
      let saved: GridCheckpointResult;
      try { saved = this.ports.checkpoint(from); }
      catch { saved = false; }
      if (saved === 'pending') { this.phase = 'save-pending'; this.issue = null; return false; }
      if (!saved) { this.phase = 'save-failed'; this.issue = 'Local checkpoint is not durable'; return false; }
    }
    const checkpointEnd = diagnosticNow();
    try { prepared.commit(); }
    catch (error) {
      prepared.cancel(); this.prepared = undefined; this.phase = 'blocked';
      this.issue = error instanceof Error ? error.message : String(error); return false;
    }
    const commitEnd = diagnosticNow();
    this.prepared = undefined; this.current = to; this.inside = undefined; this.phase = 'settled'; this.issue = null;
    this.ports.changed(from, to);
    this.completed.push(Object.freeze({ from, to, requestedAt: this.requestedAt, readyAt: this.readyAt, start, checkpointEnd, commitEnd, end: diagnosticNow() }));
    if (this.completed.length > 32) this.completed.shift();
    return true;
  }
  /** Copy the last 32 committed transitions in the same diagnostic clock as browser long tasks. */
  timings(): readonly GridCrossingTiming[] { return [...this.completed]; }
  /** State is copied so consumers cannot move a frame without committing its prepared transition. */
  state(): GridCrossingState { return { current: this.current, target: this.target, phase: this.phase, issue: this.issue }; }
  /** Explicit quota/storage retry reuses the prepared destination; fixed ticks never spam a failed durable write. */
  retrySave(): void { if (!this.disposed && this.phase === 'save-failed') { this.phase = 'ready'; this.issue = null; } }
  /** Cancel only this session's prepared destination; late completions release their own resources. */
  dispose(): void { this.disposed = true; this.generation++; this.prepared?.cancel(); this.prepared = undefined; }
}

/** Residency owns frame selection, admission, whole-world checkpoints and prepared physics transfers. */
export interface GridCrossingDriver {
  current: () => string | null;
  prepare: GridCrossingPorts['prepare'];
  ready: GridCrossingPorts['ready'];
  checkpoint: GridCrossingPorts['checkpoint'];
  target: (worldFeet: Readonly<GridPoint>) => string | null;
}
/** Fixed-step bridge installed alongside the existing residency driver, without owning another simulation or player. */
export interface GridCrossingSession { crossing: GridCrossing; step: (worldFeet: Readonly<GridPoint>) => boolean }
/** Connect local save/stow rules to assembly and residency. Call step before the residency owner's normal simulation step. */
export function installGridCrossing(driver: GridCrossingDriver, assembly: GridAssembly, local: (instance: string) => GridLoadout | undefined, scope: Scope,
  changed: GridCrossingPorts['changed'] = () => undefined): GridCrossingSession {
  const crossing = new GridCrossing(driver.current(), {
    prepare: (from, to) => driver.prepare(from, to), ready: (instance) => driver.ready(instance),
    checkpoint: (instance) => local(instance)?.checkpoint() === true && driver.checkpoint(instance),
    stow: (instance) => {
      const loadout = local(instance); if (loadout === undefined) throw new Error('Active grid instance needs its local loadout');
      loadout.stow();
    },
    interior: (instance) => local(instance)?.interior(), changed,
  });
  scope.onDispose(() => { crossing.dispose(); });
  return { crossing, step: (feet) => {
    if (scope.disposed) return false;
    const target = driver.target(feet), state = crossing.state();
    if (target !== state.target) crossing.request(target);
    return crossing.step(assembly.at(feet.x, feet.z)?.instance === crossing.state().current);
  } };
}
