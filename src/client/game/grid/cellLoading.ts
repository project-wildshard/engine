/**
 * G555 (Jake, 2026-10-21): one loading screen, the detailed step-by-step one, everywhere. A grid cell entry or re-entry
 * that waits shows the same screen as SHARD SELECT (`Loading`, in its scoped mid-play mode, on the `cell` loading path)
 * over the region's live admission: product, region world, equipment, gameplay, colliders and simulation, the entry
 * warm-up, then entry. It replaced G217's in-world hex card (`cellScreen.ts`, deleted with its 4-step plan).
 *
 * `cellLoadingStep` is the pure part: a cell's live state to its current step and detail, a refusal's reason, or done.
 * `CellLoading` owns the one scoped screen: it opens on the cell the traveller waits at (or has entered before it is
 * gameplay-ready), steps it at most a few times a second, and fades it out when the cell is ready or left.
 */
import type { CellScreen, CellScreenView } from './cellScreens';
import type { SoftWallEdge } from './softWallLook';
import { loadingPath } from '../boot/loadingPaths';

/** One waiting cell's live admission, read through the grid session's read-only port. */
export interface CellLoadingInput {
  readonly instance: string; readonly slug: string; readonly name: string;
  /** the admission refused this shard, or it cannot enter the grid yet: the screen shows why */
  readonly refusal: string | null;
  /** its product is admitted (its claim in the one allocator) and how much it holds */
  readonly product: boolean; readonly claimedMB: number;
  /** the readiness fences */
  readonly requested: boolean; readonly runtime: boolean; readonly colliders: boolean; readonly sim: boolean;
  /** a runtime region's entered hooks finished since this load began, and the one running now */
  readonly hooks: ReadonlySet<string>; readonly hook: string | null;
  /** whether it has hooks at all (a declared bodyless region has none) */
  readonly hybrid: boolean;
  /** the traveller is in it; and its gameplay is ready */
  readonly entered: boolean; readonly gameplayReady: boolean;
  /** Running warm-up of this destination root; absent for a bodyless or not-yet-warming cell. */
  readonly warm?: { readonly phase: string; readonly completed: boolean;
    readonly progress: { readonly done: number; readonly total: number; readonly detail: string } | null } | null;
}
export type CellLoadingStep = { readonly kind: 'step'; readonly key: string; readonly detail: string }
  | { readonly kind: 'failed'; readonly reason: string } | { readonly kind: 'done' };

/** The cell's current step on the `cell` path, its detail, its refusal, or done (entered and gameplay-ready). */
export function cellLoadingStep(input: CellLoadingInput): CellLoadingStep {
  if (input.refusal !== null) return { kind: 'failed', reason: input.refusal };
  if (input.entered && input.gameplayReady) return { kind: 'done' };
  if (input.warm !== undefined && input.warm !== null && input.hook === 'afterPlay') {
    if (input.warm.completed) return { kind: 'step', key: 'warm', detail: 'Entry warm-up complete' };
    const phases: Readonly<Record<string, string>> = { 'before-warm': 'Prepare scene lighting', 'post-preparation': 'Prepare render effects',
      'shaders-and-composer': 'Compile shaders', 'shader-links': 'Link shaders', 'texture-uploads': 'Upload textures',
      'parked-viewmodels': 'Warm held models', 'parked-draws': 'Warm scene draws', 'offscreen-draws': 'Warm render passes' };
    const phase = phases[input.warm.phase] ?? 'Prepare first frame', work = input.warm.progress;
    return { kind: 'step', key: 'warm', detail: work === null ? phase : `${phase} · ${work.detail}` };
  }
  const hooksDone = (last: string): boolean => !input.hybrid || input.hooks.has(last);
  if (!input.product) return { kind: 'step', key: 'world', detail: input.requested ? 'reading its region files' : 'requested as you approach' };
  const running = input.hook === null ? '' : ` · ${input.hook}`;
  if (!hooksDone('afterWorld')) return { kind: 'step', key: 'world', detail: `${input.claimedMB.toFixed(0)} MB admitted${running}` };
  if (!hooksDone('afterKit')) return { kind: 'step', key: 'loadout', detail: `weapons, held items and HUD${running}` };
  if (!hooksDone('afterPlay') || !input.runtime) return { kind: 'step', key: 'gameplay', detail: `saved state and its systems${running}` };
  if (!input.colliders || !input.sim) return { kind: 'step', key: 'colliders', detail: `${input.colliders ? 'colliders ready' : 'colliders'} · ${input.sim ? 'simulation ready' : 'simulation'}` };
  if (!input.entered) return { kind: 'step', key: 'enter', detail: 'ready: drive in' };
  return { kind: 'step', key: input.hook === 'activate' ? 'enter' : 'warm', detail: `preparing its first frame${running}` };
}

/** Where the waiting cell's screen stands: the edge the traveller meets, the cell's centre and the ground there (home frame). */
export interface CellScreenPlace { readonly edge: SoftWallEdge; readonly cell: { readonly x: number; readonly z: number }; readonly ground: number }
/** G578: the waiting cell's steps on its in-world screen (`CellScreen`); the 3D world, the road and the other cells stay live. */
export class CellLoading {
  private instance: string | null = null;
  /** the step shown: a running hook's own step, else the furthest reached (a region learns it has hooks only when they
   *  start, so between hooks a row never goes back) */
  private reached = -1;
  constructor(private readonly screen: Pick<CellScreen, 'show' | 'hide'>, private readonly place: (instance: string) => CellScreenPlace | null) {}
  /** Show, step or hide the screen from this cell's live state (null: no cell is waiting). */
  step(input: CellLoadingInput | null): void {
    if (input === null || input.instance !== this.instance) this.close();
    if (input === null) return;
    const step = cellLoadingStep(input), at = this.place(input.instance);
    if (step.kind === 'done' || at === null) { this.close(); return; }
    this.instance = input.instance;
    const path = loadingPath('cell').steps;
    if (step.kind === 'step') {
      const index = path.findIndex(row => row.key === step.key);
      this.reached = input.hook === null ? Math.max(this.reached, index) : index;
    }
    const rows = path.map((row, i): CellScreenView['rows'][number] => ({ label: row.label, state: i < this.reached ? 'done' : i === this.reached ? 'now' : 'next' }));
    const detail = step.kind === 'step' ? step.detail : '';
    this.screen.show(at.edge, at.cell, at.ground, { name: input.name, rows, detail, failed: step.kind === 'failed' ? step.reason : null });
  }
  /** The screen's cell (null: none shown). */
  get open(): string | null { return this.instance; }
  /** Hide the screen. */
  close(): void { this.instance = null; this.reached = -1; this.screen.hide(); }
}
