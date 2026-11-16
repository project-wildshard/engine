import * as v from 'valibot';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import type { SaveStorage } from '../../../shared/engine/saves/store';
import type { AnalyticsBatch, AnalyticsMap, FailureClear } from './model';

type Outcome = AnalyticsMap['failure.screen'];
interface Record { readonly build: string; readonly install: string; readonly data: Outcome }
interface Active { readonly id: string; readonly screen: string; readonly level: string; readonly since: number }
const KEY = 'failure-screen.pending', MAX = 32, MAX_BYTES = 65_536;
const Code = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,63}$/u));
const Id = v.pipe(v.string(), v.regex(/^[\w-]{8,64}$/u));
const Text = v.pipe(v.string(), v.maxLength(128));
const OutcomeSchema = v.strictObject({ id: Id, level: Text, screen: Code,
  durationMs: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  clear: v.picklist(['recovered', 'dismissed', 'replaced', 'hidden', 'pagehide', 'disposed']) });
const Records = v.pipe(v.array(v.strictObject({ build: Text, install: Text, data: OutcomeSchema })), v.maxLength(MAX));

/** Bounded pending outcomes. Storage refusal keeps the current document's copy; only successful writes survive restart. */
export class FailureOutbox {
  private memory: readonly Record[] = [];
  private readonly sending = new Set<string>();
  private readonly storage: SaveStorage | null;
  constructor(storage: SaveStorage | null) { this.storage = storage; this.memory = this.read(); }
  private read(): readonly Record[] {
    try {
      const raw = this.storage?.getItem(KEY);
      if (raw === null || raw === undefined || raw.length > MAX_BYTES) return [];
      const decoded = v.safeParse(Records, JSON.parse(raw));
      return decoded.success ? decoded.output : [];
    } catch { return []; }
  }
  /** Re-read before every mutation so a second document's additions are retained. */
  pending(): readonly Record[] {
    const merged = new Map(this.read().map(record => [record.data.id, record]));
    for (const record of this.memory) merged.set(record.data.id, record);
    return [...merged.values()].slice(-MAX);
  }
  private write(records: readonly Record[]): boolean {
    this.memory = records.slice(-MAX);
    try {
      if (this.storage === null) return false;
      if (this.memory.length === 0) this.storage.removeItem(KEY);
      else this.storage.setItem(KEY, JSON.stringify(this.memory));
      return true;
    } catch { return false; }
  }
  /** Same id always retains its immutable first outcome. False explicitly means persistence failed. */
  add(build: string, install: string, data: Outcome): boolean {
    const decoded = v.safeParse(Records, [{ build, install, data }]);
    if (!decoded.success) return false;
    const records = this.pending();
    return this.write(records.some(record => record.data.id === data.id) ? records : [...records, ...decoded.output]);
  }
  /** Acknowledge only after the API confirms its records write; failure keeps the same id and outcome. */
  async flush(deliver: (batch: AnalyticsBatch) => Promise<boolean>): Promise<void> {
    for (const record of this.pending()) {
      const id = record.data.id;
      if (this.sending.has(id)) continue;
      this.sending.add(id);
      try {
        if (await deliver({ kind: 'analytics', build: record.build, install: record.install, events: [{ name: 'failure.screen', data: record.data }] })) {
          this.write(this.pending().filter(entry => entry.data.id !== id));
        }
      } catch { /* Retained until another actual acknowledgement. */ }
      finally { this.sending.delete(id); }
    }
  }
}

/** A presenter identifies each visible root. Repaint preserves its episode; replacement ends the prior one. */
export class FailureEpisodes {
  private readonly active = new Map<object, Active>();
  private readonly emit: (outcome: Outcome) => void;
  private readonly now: () => number;
  private readonly id: () => string;
  constructor(emit: (outcome: Outcome) => void, now: () => number = diagnosticNow,
    id: () => string = crypto.randomUUID.bind(crypto)) { this.emit = emit; this.now = now; this.id = id; }
  show(root: object, screen: string, level: string): void {
    const before = this.active.get(root);
    if (before?.screen === screen && before.level === level) return;
    this.clear(root, 'replaced');
    if (!v.safeParse(Code, screen).success || !v.safeParse(Text, level).success) return;
    const since = this.now(), id = this.id();
    if (Number.isFinite(since) && v.safeParse(Id, id).success) this.active.set(root, { id, screen, level, since });
  }
  clear(root: object, clear: FailureClear): void {
    const episode = this.active.get(root);
    if (episode === undefined) return;
    this.active.delete(root);
    const elapsed = this.now() - episode.since, durationMs = Math.floor(elapsed);
    // A broken clock is unknown, not an observed zero-duration screen.
    if (!Number.isSafeInteger(durationMs) || elapsed < 0) return;
    const { since: _since, ...data } = episode;
    this.emit({ ...data, durationMs, clear });
  }
  /** Hidden/pagehide split visible time; reshowing a root starts a fresh actual episode. */
  clearAll(clear: FailureClear): void { for (const root of this.active.keys()) this.clear(root, clear); }
}
