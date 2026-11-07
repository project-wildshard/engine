import { questChip, questHint, questObjective, type QuestProgress } from './progress';
import { test, type Flags } from '../world/interact/flags';
import type { Scope } from '../app/scope';
import type { Events } from '../events/events';
import type { Cond, QuestPlace } from '../world/interact/types';
import type { QuestView } from './viewPort';

export interface QuestMarker {
  id: string;
  label: string;
  /** the HUD chip's short name for it ("SEA CAVE" for "SEA CAVE KEY"); the map keeps `label` */
  short?: string;
  at: QuestPlace;
  /** hidden once this holds (the level at this spot was taken) */
  hideWhen?: Cond;
}

export interface QuestStep {
  id: string;
  /** the objective line; `{n}` / `{of}` are replaced by the step's counter */
  objective: string;
  /** the HUD chip's label (≤ CHIP_MAX chars, no counter: the chip appends `n/of` itself); falls back to `objective` */
  chip?: string;
  /** the step's sub-steps / a hint under the objective (the map tab's quest card) */
  hint?: string;
  done: Cond;
  /** counts the flags that are set (`{n}`) out of all of them (`{of}`) */
  count?: string[];
  markers?: QuestMarker[];
}

export interface QuestDef {
  id: string;
  title: string;
  /** the quest is offered (appears at all) once this holds; before it the objective is `intro` */
  startWhen?: Cond;
  intro?: { objective: string; chip?: string; hint?: string; markers?: QuestMarker[] };
  steps: QuestStep[];
  /** raised once every step is done */
  completeFlag: string;
}

export interface DialogueEntry {
  /** the first entry whose condition holds is what the NPC says */
  when?: Cond;
  lines: string[];
  /** flags raised when the conversation ends */
  sets?: string[];
}
export interface NpcDef { id: string; name: string; dialogue: DialogueEntry[] }

export function lineFor(npc: NpcDef, flags: { has: (f: string) => boolean }): DialogueEntry | null {
  return npc.dialogue.find((d) => test(flags, d.when)) ?? null;
}


interface QuestSnapshot { version: number; id: string; started: boolean; currentId: string | null }
export class QuestState {
  onStep?: (step: QuestStep | null, prev: QuestStep | null) => void;
  onComplete?: () => void;
  private cur: QuestStep | null;
  private started: boolean;
  private unsub: () => void;
  private readonly observers = new Set<{ step?: (step: QuestStep | null, previous: QuestStep | null) => void; complete?: () => void }>();

  readonly def: QuestDef;
  readonly flags: Flags;
  private readonly events: Events | undefined;
  constructor(def: QuestDef, flags: Flags, events?: Events, scope?: Scope) {
    this.def = def; this.flags = flags; this.events = events;
    this.started = test(flags, def.startWhen);
    this.cur = this.compute();
    this.unsub = flags.onChange(() => this.tick());
    scope?.onDispose(() => this.dispose());
  }

  dispose(): void { this.unsub(); this.observers.clear(); }
  /** Multiple scoped views can observe transitions without replacing the authored callbacks. */
  observe(observer: { step?: (step: QuestStep | null, previous: QuestStep | null) => void; complete?: () => void }): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  get isStarted(): boolean { return this.started; }
  get isComplete(): boolean { return this.flags.has(this.def.completeFlag); }
  get current(): QuestStep | null { return this.started ? this.cur : null; }
  /** index of the current step (steps.length when complete, -1 before it starts) */
  get index(): number { return !this.started ? -1 : this.cur ? this.def.steps.indexOf(this.cur) : this.def.steps.length; }
  snapshot(): QuestSnapshot { return { version: 1, id: this.def.id, started: this.started, currentId: this.cur?.id ?? null }; }
  restore(state: ReturnType<QuestState['snapshot']>): void {
    const current = state.currentId === null ? null : this.def.steps.find((step) => step.id === state.currentId);
    if (state.version !== 1 || state.id !== this.def.id || typeof state.started !== 'boolean' || current === undefined) throw new RangeError('Invalid quest snapshot');
    this.started = state.started; this.cur = current;
  }

  private compute(): QuestStep | null { return this.def.steps.find((s) => !test(this.flags, s.done)) ?? null; }

  private tick(): void {
    const started = test(this.flags, this.def.startWhen);
    const next = this.compute();
    if (started === this.started && next === this.cur) return;
    const prev = this.started ? this.cur : null;
    this.started = started; this.cur = next;
    if (!started) return;
    if (next === null && !this.flags.has(this.def.completeFlag)) {
      this.flags.set(this.def.completeFlag); this.onComplete?.();
      for (const observer of this.observers) observer.complete?.();
    }
    this.events?.emit('quest.step', { level: this.flags.level, quest: this.def.id, step: next?.id ?? null, previous: prev?.id ?? null });
    this.onStep?.(next, prev);
    for (const observer of this.observers) observer.step?.(next, prev);
  }

  counter(step: QuestStep | null = this.current): { n: number; of: number } | null {
    if (!step?.count) return null;
    return { n: step.count.filter((f) => this.flags.has(f)).length, of: step.count.length };
  }

  objective(): string { return questObjective(this.def, this.started, this.cur, this.counter(this.cur)); }
  chip(): { label: string; count: string } { return questChip(this.def, this.started, this.cur, this.counter(this.cur)); }
  hint(): string { return questHint(this.def, this.started, this.cur); }
  /** What a client is told of this quest. */
  progress(): QuestProgress { return { quest: this.def.id, started: this.started, step: this.cur?.id ?? null, n: this.counter(this.cur)?.n ?? 0 }; }

  markers(): QuestMarker[] {
    const list = !this.started ? this.def.intro?.markers ?? [] : this.cur?.markers ?? [];
    return list.filter((m) => m.hideWhen === undefined || !test(this.flags, m.hideWhen));
  }
}

/** the longest chip label / marker short name that fits the HUD chip on a 390 px phone without an ellipsis */
export const CHIP_MAX = 18;


/** chained chapters: each def's `startWhen` reads the one before's `completeFlag`; the active one is the first not done */
export class QuestLine {
  readonly chapters: QuestState[];
  /** a chapter's current step changed (null = it just completed) */
  onStep?: (chapter: QuestState, step: QuestStep | null, prev: QuestStep | null) => void;
  onComplete?: (chapter: QuestState) => void;

  constructor(defs: QuestDef[], flags: Flags, events?: Events, scope?: Scope) {
    this.chapters = defs.map((d) => {
      const q = new QuestState(d, flags, events, scope);
      q.onStep = (s, p) => { this.onStep?.(q, s, p); };
      q.onComplete = () => { this.onComplete?.(q); };
      return q;
    });
  }

  /** the chapter being played: the first not complete (null once the line is finished) */
  get active(): QuestState | null { return this.chapters.find((q) => !q.isComplete) ?? null; }
  /** 1-based chapter number of `q` */
  number(q: QuestState): number { return this.chapters.indexOf(q) + 1; }
  dispose(): void { for (const q of this.chapters) q.dispose(); }
}

/** Authored quest notice prefixes; an optional first-step id selects the introductory notice. */
export interface QuestMessageRows { readonly firstStep?:string;readonly started:string;readonly objective:string;readonly completed:string }
/** Caller-owned presentation effects and an optional beat after the transition sting. */
export interface QuestMessagePorts {readonly toast:(text:string)=>void;readonly sting:()=>void;readonly afterStep?:(step:QuestStep|null)=>void}
/** Preflight authored notices without observing or owning quest state. The caller keeps its original phase. */
export function questMessageHandlers(quest:Pick<QuestView,'def'|'objective'>,rows:QuestMessageRows,ports:QuestMessagePorts):{
  step:(step:QuestStep|null,previous:QuestStep|null)=>void;complete:()=>void;
} {
  const valid=(value:unknown):boolean=>typeof value==='string'&&value.length<=8192;
  if(!valid(rows.started)||!valid(rows.objective)||!valid(rows.completed)
    ||(rows.firstStep!==undefined&&!quest.def.steps.some(step=>step.id===rows.firstStep)))throw new Error('Invalid quest message rows');
  return {step:(step,previous)=>{
    if(step!==null)ports.toast(previous===null&&(rows.firstStep===undefined||step.id===rows.firstStep)
      ?rows.started+quest.def.title:rows.objective+quest.objective());
    ports.sting();ports.afterStep?.(step);
  },complete:()=>{ports.toast(rows.completed+quest.def.title);}};
}
