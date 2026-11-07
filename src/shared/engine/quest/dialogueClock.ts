import * as v from 'valibot';
import {lineFor,type DialogueEntry,type NpcDef} from './core';

const finite = v.pipe(v.number(), v.finite());
const Saved: v.GenericSchema<BoundedDialogueSaveInput, BoundedDialogueSave> = v.strictObject({ version: v.literal(1),
  lines: v.pipe(v.array(v.pipe(v.string(), v.maxLength(8192))), v.maxLength(128)),
  index: v.pipe(finite, v.integer(), v.minValue(0)), shown: v.pipe(finite, v.minValue(0)), open: v.boolean(),
});
export type DialogueSaved = v.InferOutput<typeof Saved>;
export type DialogueAdvance = 'inactive' | 'typing' | 'line' | 'finished';

/** The dialogue panel's type-out and advance law, without UI, input or a completion callback. */
export class DialogueClock {
  private lines: readonly string[] = [];
  private i = 0;
  private shown = 0;
  private active = false;
  get isOpen(): boolean { return this.active; }
  get index(): number { return this.i; }
  get count(): number { return this.lines.length; }
  get line(): string { return this.lines[this.i] ?? ''; }
  get text(): string { return this.line.slice(0, Math.floor(this.shown)); }

  /** Empty dialogue completes immediately without replacing an already open panel. */
  open(lines: readonly string[]): boolean {
    if (lines.length === 0) return false;
    this.lines = lines; this.i = 0; this.shown = 0; this.active = true;
    return true;
  }
  advance(): DialogueAdvance {
    if (!this.active) return 'inactive';
    const cur = this.line;
    if (this.shown < cur.length) { this.shown = cur.length; return 'typing'; }
    this.i++; this.shown = 0;
    if (this.i >= this.lines.length) { this.active = false; return 'finished'; }
    return 'line';
  }
  close(): void { this.active = false; }
  /** Returns whether the panel previously still had typing to render, including a zero-delta frame. */
  update(dt: number, cps = 60): boolean {
    if (!this.active || this.shown >= this.line.length) return false;
    this.shown = Math.min(this.line.length, this.shown + dt * cps);
    return true;
  }
  snapshot(): DialogueSaved { return v.parse(Saved, { version: 1, lines: this.lines, index: this.i, shown: this.shown, open: this.active }); }
  prepareRestore(value: unknown): () => void {
    const saved = v.parse(Saved, value), line = saved.lines[saved.index] ?? '';
    if (saved.index > saved.lines.length || (saved.open && saved.index >= saved.lines.length) || saved.shown > line.length) {
      throw new RangeError('Invalid dialogue continuation');
    }
    return () => { this.lines = saved.lines; this.i = saved.index; this.shown = saved.shown; this.active = saved.open; };
  }
  restore(value: unknown): void { this.prepareRestore(value)(); }
}

const NpcSaved = v.strictObject({ version: v.literal(1), npc: v.string(),
  entry: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))), clock: v.unknown(),
});
/** Actual flags lent by the current quest; completion is their only write path. */
export interface DialogueFlags { readonly has: (flag: string) => boolean; readonly set: (flag: string) => void }

/** Renderer-free NPC dialogue: the panel's clock, authored line selection, and flags committed only on completion. */
export class NpcDialogue {
  readonly clock:DialogueClock;
  private entry: DialogueEntry | null = null;
  private readonly npc: NpcDef;
  private readonly flags: DialogueFlags;
  constructor(npc:NpcDef,flags:DialogueFlags,clock:DialogueClock=new DialogueClock()) {this.npc=npc;this.flags=flags;this.clock=clock;}

  open(): boolean {
    if (this.clock.isOpen) { this.advance(); return this.clock.isOpen; }
    const entry=this.select();
    if(entry===null)return false;
    if (!this.clock.open(entry.lines)) this.finish();
    return this.clock.isOpen;
  }
  advance(): void { if (this.clock.advance() === 'finished') this.finish(); }
  update(dt: number): void { this.clock.update(dt); }
  cancel(): void { this.clock.close(); this.entry = null; }
  /** Select without driving a borrowed clock; page presentation opens its same panel next. */
  select():DialogueEntry|null {const entry=lineFor(this.npc,this.flags);this.entry=entry;return entry;}
  /** Commit only a completed reading; cancellation never grants the entry's flags. */
  finish(): void {
    if(this.clock.isOpen)throw new Error('Open dialogue cannot complete');
    const entry = this.entry; this.entry = null;
    for (const flag of entry?.sets ?? []) this.flags.set(flag);
  }
  snapshot(): { version: 1; npc: string; entry: number | null; clock: ReturnType<DialogueClock['snapshot']> } {
    return { version: 1, npc: this.npc.id, entry: this.entry === null ? null : this.npc.dialogue.indexOf(this.entry), clock: this.clock.snapshot() };
  }
  prepareRestore(value: unknown): () => void {
    const saved = v.parse(NpcSaved, value), clock = new DialogueClock(); clock.restore(saved.clock);
    const entry = saved.entry === null ? null : this.npc.dialogue[saved.entry];
    const state = clock.snapshot();
    if (saved.npc !== this.npc.id || entry === undefined || (entry !== null) !== clock.isOpen
      || (entry !== null && (entry.lines.length !== state.lines.length || entry.lines.some((line, i) => line !== state.lines[i])))) {
      throw new RangeError('Incompatible NPC dialogue continuation');
    }
    const commit = this.clock.prepareRestore(state);
    return () => { commit(); this.entry = entry; };
  }
  restore(value: unknown): void { this.prepareRestore(value)(); }
}

/** Borrowed head/prompt coordinates; walking away is measured from the feet. */
export interface DialoguePoint { readonly x: number; readonly y: number; readonly z: number }
const ReadingProfile = v.strictObject({ radius: v.pipe(finite, v.minValue(0), v.maxValue(1000)),
  keyDelay: v.pipe(finite, v.minValue(0), v.maxValue(10)) });
const ReadingSaved = v.strictObject({ dialogue: v.unknown(), elapsed: v.pipe(finite, v.minValue(0)) });

/** One NPC reading's use debounce, reach and old continuation envelope.
 * An owned clock drives native reading. A lent page clock is fetched lazily
 * when selecting a line; the actual panel keeps its input/type-out timer.
 * Completion commits authored flags; cancellation/restore never grants them.
 */
export class NpcReading {
  private reading: NpcDialogue | null;
  private elapsed = 0;
  private readonly profile: v.InferOutput<typeof ReadingProfile>;
  private readonly npc: NpcDef;
  private readonly flags: DialogueFlags;
  private readonly at: DialoguePoint;
  private readonly borrowedClock: (() => DialogueClock) | undefined;
  constructor(npc: NpcDef, flags: DialogueFlags, at: DialoguePoint, radius: number, keyDelay = 0,
    borrowedClock?: () => DialogueClock) {
    this.npc = npc; this.flags = flags; this.at = at; this.borrowedClock = borrowedClock;
    this.profile = v.parse(ReadingProfile, { radius, keyDelay });
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(at.z)) throw new RangeError('Invalid NPC reading position');
    this.reading = borrowedClock === undefined ? new NpcDialogue(npc, flags) : null;
  }
  private session(): NpcDialogue {
    if (this.borrowedClock !== undefined) {
      const clock = this.borrowedClock();
      if (this.reading?.clock !== clock) this.reading = new NpcDialogue(this.npc, this.flags, clock);
    }
    if (this.reading === null) throw new Error('Missing NPC reading clock');
    return this.reading;
  }
  get active(): boolean { return this.session().clock.isOpen; }
  /** The lent clock stays the same object; no parallel timer is installed. */
  get clock(): DialogueClock { return this.session().clock; }
  select(): DialogueEntry | null { return this.session().select(); }
  finish(): void { this.session().finish(); }
  /** A close-range prompt can advance only after its authored key delay. */
  use(): void {
    const reading = this.session();
    if (this.active) { if (this.elapsed >= this.profile.keyDelay) reading.advance(); }
    else { this.elapsed = 0; reading.open(); }
  }
  dismiss(): void { this.session().cancel(); this.elapsed = 0; }
  /** The existing talk reach is radius + 2.5 m, independent of eye prompt picking. */
  outside(feet: DialoguePoint): boolean {
    if (!Number.isFinite(feet.x) || !Number.isFinite(feet.y) || !Number.isFinite(feet.z)) throw new RangeError('Invalid NPC reading feet');
    const x = feet.x - this.at.x, y = feet.y - this.at.y, z = feet.z - this.at.z;
    return Math.sqrt(x * x + y * y + z * z) > this.profile.radius + 2.5;
  }
  /** Native reading only; a page's panel owns updating its borrowed clock. */
  step(dt: number, feet: DialoguePoint): void {
    if (this.borrowedClock !== undefined) throw new Error('The page owns its NPC reading clock');
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid NPC reading step');
    if (!this.active) return;
    if (this.outside(feet)) { this.dismiss(); return; }
    this.elapsed = Math.min(this.profile.keyDelay, this.elapsed + dt); this.session().update(dt);
  }
  snapshot(): { dialogue: ReturnType<NpcDialogue['snapshot']>; elapsed: number } | null {
    return this.active ? { dialogue: this.session().snapshot(), elapsed: this.elapsed } : null;
  }
  /** Prepare the old {dialogue, elapsed} envelope without changing state/flags. */
  prepareRestore(value: unknown): () => void {
    if (this.borrowedClock !== undefined) throw new Error('The page owns its NPC reading continuation');
    if (value === null) return () => { this.dismiss(); };
    const saved = v.parse(ReadingSaved, value);
    if (saved.elapsed > this.profile.keyDelay) throw new RangeError('Invalid NPC reading delay');
    const candidate = new NpcDialogue(this.npc, { has: () => false, set: () => undefined });
    candidate.restore(saved.dialogue);
    if (!candidate.clock.isOpen) throw new RangeError('A saved NPC dialogue must still be open');
    const commit = this.session().prepareRestore(saved.dialogue);
    return () => { commit(); this.elapsed = saved.elapsed; };
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedDialogueSaveInput = BoundedDialogueSave;
interface BoundedDialogueSaveFields {
    version: 1;
    lines: string[];
    index: number;
    shown: number;
    open: boolean;
}
type BoundedDialogueSave = { [Key in keyof BoundedDialogueSaveFields]: BoundedDialogueSaveFields[Key] };
