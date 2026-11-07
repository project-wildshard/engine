import * as schema from 'valibot';
import { STATE_ORDER, type EntryDef, type EntryState, type EntryStats, type ShardCompendium } from './types';

/** one entry's save: s = STATE_ORDER index, n = seen, t = taken, b = best kg */
interface Saved { s: number; n: number; t: number; b: number }
type ShardSave = Record<string, Saved>;

const num = (v: unknown, lo = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, v) : lo);

/** a shard's save, cleaned: unknown ids dropped, every field a finite number in range */
function loadShard(raw: unknown, ids: ReadonlySet<string>): ShardSave {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: ShardSave = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(id) || typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    out[id] = { s: Math.min(STATE_ORDER.length - 1, Math.round(num(r['s']))), n: Math.round(num(r['n'])), t: Math.round(num(r['t'])), b: num(r['b']) };
  }
  return out;
}

const count = schema.pipe(schema.number(), schema.safeInteger(), schema.minValue(0));
const SavedEntry = schema.strictObject({ s: schema.pipe(count, schema.maxValue(STATE_ORDER.length - 1)), n: count, t: count,
  b: schema.pipe(schema.number(), schema.finite(), schema.minValue(0)) });
const Snapshot: schema.GenericSchema<BoundedCompendiumRulesSaveInput, BoundedCompendiumRulesSave> = schema.strictObject({ version: schema.literal(1), entries: schema.record(schema.string(), SavedEntry) });
/** The exact in-memory discovery and statistics continuation, independent of a page save slot. */
export type CompendiumSnapshot = schema.InferOutput<typeof Snapshot>;

/** Shared discovery/statistics law. A page subclass supplies persistence; a native owner captures and silently restores
 * this strict continuation. Construction retains the page's tolerant historical-save cleaning. */
export class CompendiumRules {
  private save: ShardSave;
  private byId = new Map<string, EntryDef>();
  /** entry → from → to, for every forward move (the "new journal entry" toast, the trophy wall's re-mount) */
  onChange?: (entry: EntryDef, from: EntryState, to: EntryState) => void;
  /** any stat moved (the open book re-renders) */
  onUpdate?: () => void;

  readonly def: ShardCompendium;

  constructor(def: ShardCompendium, saved: unknown = {}) {
    this.def = def;
    for (const e of def.entries) this.byId.set(e.id, e);
    this.save = loadShard(saved, new Set(this.byId.keys()));
  }

  entry(id: string): EntryDef | undefined { return this.byId.get(id); }

  stats(id: string): EntryStats {
    const s = this.save[id];
    return { state: STATE_ORDER[s?.s ?? 0] ?? 'unknown', seen: s?.n ?? 0, taken: s?.t ?? 0, best: s?.b ?? 0 };
  }
  state(id: string): EntryState { return this.stats(id).state; }
  /** has the entry reached `at` (or beyond)? */
  reached(id: string, at: EntryState): boolean { return STATE_ORDER.indexOf(this.state(id)) >= STATE_ORDER.indexOf(at); }

  /** entries that answer to a kill / sighting of (kind, variant) */
  matching(kind: string, variant?: string): EntryDef[] {
    return this.def.entries.filter((e) => e.match?.kind === kind && (e.match.variants === undefined || (variant !== undefined && e.match.variants.includes(variant))));
  }
  /** the place entry for a POI id (entries of kind 'place' use the POI id as their own) */
  place(id: string): EntryDef | undefined { const e = this.byId.get(id); return e?.kind === 'place' ? e : undefined; }

  // ── the generic transitions ──
  /** move `id` forward to `to` (never back); returns whether anything changed. `bump` edits the counters first. */
  private advance(id: string, to: EntryState, bump?: (s: Saved) => void): boolean {
    const e = this.byId.get(id);
    if (!e) return false;
    const s = (this.save[id] ??= { s: 0, n: 0, t: 0, b: 0 });
    const before = { ...s };
    bump?.(s);
    const from = STATE_ORDER[s.s] ?? 'unknown';
    const target = STATE_ORDER.indexOf(to);
    if (target > s.s) s.s = target;
    const moved = s.s !== before.s, changed = moved || s.n !== before.n || s.t !== before.t || s.b !== before.b;
    if (!changed) return false;
    this.persist();
    if (moved) this.onChange?.(e, from, STATE_ORDER[s.s] ?? to);
    this.onUpdate?.();
    return true;
  }

  discover(id: string): boolean { return this.advance(id, 'discovered'); }
  see(id: string): boolean { return this.advance(id, 'seen', (s) => { s.n++; }); }
  take(id: string, kg = 0): boolean {
    const e = this.byId.get(id);
    if (e?.kind === 'place') return false; // a place is visited, never taken
    return this.advance(id, 'taken', (s) => { s.t++; if (kg > s.b) s.b = Math.round(kg); });
  }

  // ── the game's events ──
  animalNear(kind: string, variant?: string): void { for (const e of this.matching(kind, variant)) this.discover(e.id); }
  animalSpotted(kind: string, variant?: string): void { for (const e of this.matching(kind, variant)) this.see(e.id); }
  animalKilled(kind: string, variant: string | undefined, kg: number): void { for (const e of this.matching(kind, variant)) this.take(e.id, kg); }
  placeNear(id: string): void { if (this.place(id)) this.discover(id); }
  placeVisited(id: string): void { if (this.place(id)) this.see(id); }

  /** entries of a tab, in table order */
  tab(tab: string): EntryDef[] { return this.def.entries.filter((e) => e.tab === tab); }
  /** how many of a tab's entries have reached `at` */
  count(tab: string, at: EntryState): number { return this.tab(tab).filter((e) => this.reached(e.id, at)).length; }

  /** A copy: consumers cannot mutate the live counters through the checkpoint. */
  snapshot(): CompendiumSnapshot { return { version: 1, entries: Object.fromEntries(Object.entries(this.save).map(([id, entry]) => [id, { ...entry }])) }; }

  /** Validate fully before replacing any state. Restoration emits no discovery, write or callback. */
  prepareRestore(input: unknown): () => void {
    const next = schema.parse(Snapshot, input);
    if (Object.keys(next.entries).some(id => !this.byId.has(id))) throw new RangeError('Unknown compendium entry');
    const entries = Object.fromEntries(Object.entries(next.entries).map(([id, entry]) => [id, { ...entry }]));
    return () => { this.save = entries; };
  }
  restore(input: unknown): void { this.prepareRestore(input)(); }

  /** Page persistence hook; pure/native owners leave it absent. */
  protected persist(): void { /* A page owner overrides persistence; a native owner only captures. */ }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedCompendiumRulesSaveInput = BoundedCompendiumRulesSave;
interface BoundedCompendiumRulesSaveFields {
    version: 1;
    entries: Record<string, {
            s: number;
            n: number;
            t: number;
            b: number;
        }>;
}
type BoundedCompendiumRulesSave = { [Key in keyof BoundedCompendiumRulesSaveFields]: BoundedCompendiumRulesSaveFields[Key] };
