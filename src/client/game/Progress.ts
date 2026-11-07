import { resourceScope } from '@wildshard/engine/app/resources';
import { progressSave, saveSlug } from '../../shared/game/saves';
import { updateSummary } from './summary';
import { findTitleManifest } from './shard/titleList';
import { findShard } from './shard/registry';
/**
 * Progress — per-shard achievement progress, earned titles and the title you wear. Persisted in
 * localStorage ('ws.progress.v1', keyed by chunk id); the in-memory copy is the truth for the session
 * (iOS private mode throws on write).
 *
 *   const progress = new Progress(getActiveChunk().id);
 *   progress.recordKill(animal.kind, animal.variant);     // main.ts, on every kill → fires onEarned for each new unlock
 *   progress.onEarned = (def) => hud.toast(…);
 *   progress.rows                                          // [{ def, count, earned }] for the Achievements tab
 *   progress.title / progress.wear(def.id)                 // the worn title (the first earned one is worn automatically)
 */
import { achievementsFor, type AchievementDef } from '../../shared/game/achievements';

interface ShardProgress { counts: Record<string, number>; earned: string[]; title: string | null; playS: number }
const PLAY_SAVE_S = 15;


/** Read-only achievement state from the authoritative ledger; the shard's feat table owns presentation. */
export interface ProgressLedger {
  readonly count: (id: string) => number;
  readonly earned: (id: string) => boolean;
  /** Retry the actual ledger's pending profile write; false refuses the enclosing runtime checkpoint. */
  readonly checkpoint: () => boolean;
}

export interface ProgressRow { def: AchievementDef; count: number; earned: boolean; active: boolean }

export class Progress {
  private readonly scope = resourceScope().child('Progress');
  readonly defs: AchievementDef[];
  private shard: ShardProgress;
  private ledger: ProgressLedger | undefined;
  private projected = new Map<string, { count: number; earned: boolean }>();
  onEarned?: (def: AchievementDef) => void;
  onChange?: () => void;

  constructor(readonly chunkId: string) {
    this.defs = achievementsFor(chunkId);
    this.shard = progressSave.read(saveSlug(chunkId));
    this.updateSummary();
    const flush = (): void => { if (this.unsaved > 0) { this.unsaved = 0; this.save(); } };
    if (typeof document !== 'undefined') { // not in the node tests
      this.scope.listen(window, 'pagehide', flush);
      this.scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    }
  }

  /** Adopt ledger state without replaying grants, legacy counters or notifications for already-earned feats. */
  bindLedger(ledger: ProgressLedger): void {
    this.ledger = ledger;
    this.projected = new Map(this.defs.map((def) => [def.id, { count: this.count(def.id), earned: this.earned(def.id) }]));
    this.updateSummary();
  }

  /** Refresh after an authoritative fact: notify new feats once, without granting or writing progress counters. */
  refreshLedger(): void {
    if (this.ledger === undefined) return;
    let changed = false;
    const newlyEarned: AchievementDef[] = [];
    for (const def of this.defs) {
      const previous = this.projected.get(def.id), count = this.count(def.id), earned = this.earned(def.id);
      if (previous === undefined || previous.count !== count || previous.earned !== earned) changed = true;
      if (previous?.earned === false && earned) newlyEarned.push(def);
      this.projected.set(def.id, { count, earned });
    }
    if (!changed) return;
    if ((this.shard.title === null || this.shard.title === '') && newlyEarned[0] !== undefined) {
      this.shard.title = newlyEarned[0].id;
      this.save(); // Only title/play metadata changed; ledger counters and grants stay authoritative.
    } else this.updateSummary();
    for (const def of newlyEarned) this.onEarned?.(def);
    this.onChange?.();
  }

  private unsaved = 0;
  /** seconds played on this shard (E132): main.ts counts the frames in the world, not the title or the menus */
  get playS(): number { return this.shard.playS; }
  addPlay(dt: number): void {
    if (!(dt > 0)) return;
    const s = Math.min(dt, 0.25);
    this.shard.playS = this.playS + s;
    this.unsaved += s;
    if (this.unsaved >= PLAY_SAVE_S) { this.unsaved = 0; this.save(); }
  }

  /** Plugin registrations refine the total after level.kit; legacy shards retain their table count. */
  setFeatTotal(total: number): void { this.featTotal = total; this.updateSummary(); }
  private featTotal: number | undefined;
  private updateSummary(): void {
    const slug = saveSlug(this.chunkId);
    if ((findShard(slug)??findTitleManifest(slug)) !== undefined) updateSummary(slug, this.ledger === undefined ? this.shard
      : { earned: this.defs.filter((def) => this.earned(def.id)).map((def) => def.id), playS: this.playS }, this.featTotal ?? this.defs.length);
  }
  private save() { progressSave.write(this.shard, saveSlug(this.chunkId)); this.updateSummary(); }

  /** Persist current progress and unsaved play time; false keeps the state available for a later retry. */
  checkpoint(): boolean {
    const metadata = progressSave.write(this.shard, saveSlug(this.chunkId));
    const ledger = this.ledger?.checkpoint() ?? true;
    const durable = metadata && ledger;
    if (durable) this.unsaved = 0;
    this.updateSummary();
    return durable;
  }

  /** one kill of (kind, variant) — bumps every matching achievement, unlocks the ones that reach their count */
  recordKill(kind: string, variant?: string): void {
    if (this.ledger !== undefined) return;
    let changed = false;
    for (const d of this.defs) {
      if (d.kind !== kind || (d.variant && d.variant !== variant)) continue;
      const n = Math.min(d.count, (this.shard.counts[d.id] ?? 0) + 1);
      if (n === this.shard.counts[d.id]) continue;
      this.shard.counts[d.id] = n; changed = true;
      if (n >= d.count && !this.shard.earned.includes(d.id)) {
        this.shard.earned.push(d.id);
        if (this.shard.title === null || this.shard.title === '') this.shard.title = d.id; // the first title is worn straight away
        this.onEarned?.(d);
      }
    }
    if (changed) { this.save(); this.onChange?.(); }
  }

  /**
   * An adventure event (achievements with `event`): bumps each matching achievement by one, or — with `total` —
   * raises it to that total (idempotent: a collectible count read back from the quest flags after a reload).
   */
  recordEvent(event: string, total?: number): void {
    if (this.ledger !== undefined) return;
    let changed = false;
    for (const d of this.defs) {
      if (d.event === undefined || d.event !== event) continue;
      const was = this.shard.counts[d.id] ?? 0;
      const n = Math.min(d.count, total !== undefined ? Math.max(was, total) : was + 1);
      if (n === was) continue;
      this.shard.counts[d.id] = n; changed = true;
      if (n >= d.count && !this.shard.earned.includes(d.id)) {
        this.shard.earned.push(d.id);
        if (this.shard.title === null || this.shard.title === '') this.shard.title = d.id;
        this.onEarned?.(d);
      }
    }
    if (changed) { this.save(); this.onChange?.(); }
  }

  count(id: string): number { return this.ledger?.count(id) ?? this.shard.counts[id] ?? 0; }
  earned(id: string): boolean { return this.ledger?.earned(id) ?? this.shard.earned.includes(id); }
  get earnedCount(): number { return this.ledger === undefined ? this.shard.earned.length : this.defs.filter((def) => this.earned(def.id)).length; }
  /** the worn title's def, if any */
  get title(): AchievementDef | null { return this.defs.find((d) => d.id === this.shard.title && this.earned(d.id))
    ?? (this.ledger === undefined ? null : this.defs.find((d) => this.earned(d.id)) ?? null); }
  /** wear an earned title (ignored when not earned) */
  wear(id: string): void {
    if (!this.earned(id) || this.shard.title === id) return;
    this.shard.title = id; this.save(); this.onChange?.();
  }
  get rows(): ProgressRow[] {
    const t = this.title;
    return this.defs.map((def) => ({ def, count: this.count(def.id), earned: this.earned(def.id), active: t?.id === def.id }));
  }
}
