import type { QuestDef, QuestMarker, QuestStep } from '../../../../shared/engine/quest/core';
import type { QuestGateView, QuestView, QuestViewObserver } from '../../../../shared/engine/quest/viewPort';
import { test } from '../../../../shared/engine/world/interact/flags';
import { questChip, questHint, questObjective, type QuestCount, type QuestProgress } from '../../../../shared/engine/quest/progress';

/**
 * P1-E3.3: a client's quests, read from what the server replicates. It holds the shard's quest rows and each quest's
 * latest progress and decides nothing: the text is the same law the server's QuestState speaks with.
 */
export class QuestReplica {
  private readonly defs: ReadonlyMap<string, QuestDef>;
  private readonly progress: ReadonlyMap<string, QuestProgress>;
  constructor(defs: readonly QuestDef[], progress: ReadonlyMap<string, QuestProgress>) {
    this.defs = new Map(defs.map(def => [def.id, def])); this.progress = progress;
  }
  private read(id: string): { def: QuestDef; started: boolean; step: QuestStep | null; count: QuestCount | null } {
    const def = this.defs.get(id); if (def === undefined) throw new Error(`Unknown quest ${id}`);
    const row = this.progress.get(id), step = row?.step === null || row === undefined ? null : def.steps.find(entry => entry.id === row.step) ?? null;
    return { def, started: row?.started ?? false, step, count: step?.count === undefined ? null : { n: row?.n ?? 0, of: step.count.length } };
  }
  isStarted(id: string): boolean { return this.read(id).started; }
  objective(id: string): string { const { def, started, step, count } = this.read(id); return questObjective(def, started, step, count); }
  chip(id: string): { label: string; count: string } { const { def, started, step, count } = this.read(id); return questChip(def, started, step, count); }
  hint(id: string): string { const { def, started, step } = this.read(id); return questHint(def, started, step); }
}

/** One quest as a view reads it, from the rows a client holds (E6). `QuestViewFeed.sync` tells it a row moved. */
export class NetQuestView implements QuestView {
  readonly def: QuestDef;
  private readonly replica: QuestReplica;
  private readonly gates: QuestGateView;
  private readonly row: () => QuestProgress | undefined;
  private readonly observers = new Set<QuestViewObserver>();
  private lastStarted: boolean;
  private lastStep: QuestStep | null;
  constructor(def: QuestDef, replica: QuestReplica, gates: QuestGateView, row: () => QuestProgress | undefined) {
    this.def = def; this.replica = replica; this.gates = gates; this.row = row;
    this.lastStarted = this.isStarted; this.lastStep = this.step();
  }
  private step(): QuestStep | null { const id = this.row()?.step ?? null; return id === null ? null : this.def.steps.find(step => step.id === id) ?? null; }
  get isStarted(): boolean { return this.replica.isStarted(this.def.id); }
  /** A started quest with no step left is finished: the server sends no step once it is. */
  get isComplete(): boolean { return this.isStarted && this.step() === null; }
  get current(): QuestStep | null { return this.isStarted ? this.step() : null; }
  objective(): string { return this.replica.objective(this.def.id); }
  chip(): { label: string; count: string } { return this.replica.chip(this.def.id); }
  hint(): string { return this.replica.hint(this.def.id); }
  markers(): QuestMarker[] {
    const list = !this.isStarted ? this.def.intro?.markers ?? [] : this.step()?.markers ?? [];
    return list.filter(marker => marker.hideWhen === undefined || !test(this.gates, marker.hideWhen));
  }
  observe(observer: QuestViewObserver): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }
  /** Take the rows as they stand, telling nobody: what a save opened with is no news. */
  settle(): void { this.lastStarted = this.isStarted; this.lastStep = this.step(); }
  /** Tell observers what the newest row changed, as the server's quest told its own: the finish, then the step. */
  sync(): void {
    const started = this.isStarted, next = this.step(), previous = this.lastStarted ? this.lastStep : null;
    if (started === this.lastStarted && next === this.lastStep) return;
    const finished = started && next === null && !(this.lastStarted && this.lastStep === null);
    this.lastStarted = started; this.lastStep = next;
    if (!started) return;
    if (finished) for (const observer of this.observers) observer.complete?.();
    for (const observer of this.observers) observer.step?.(next, previous);
  }
}

/** A client's quest and gate views, over the rows it was sent. Call `sync` once a frame, after the frame's events. */
export class QuestViewFeed {
  /** This player's own world (J106): the `phase` events. */
  readonly gates: QuestGateView;
  private readonly views = new Map<string, NetQuestView>();
  constructor(defs: readonly QuestDef[], client: { readonly quests: ReadonlyMap<string, QuestProgress>; readonly phased: ReadonlySet<string> }) {
    const replica = new QuestReplica(defs, client.quests);
    this.gates = { has: flag => client.phased.has(flag) };
    for (const def of defs) this.views.set(def.id, new NetQuestView(def, replica, this.gates, () => client.quests.get(def.id)));
  }
  quest(id: string): NetQuestView {
    const view = this.views.get(id);
    if (view === undefined) throw new Error(`Unknown quest ${id}`);
    return view;
  }
  sync(): void { for (const view of this.views.values()) view.sync(); }
  /** Take every row as it stands: the first frame of a session. */
  settle(): void { for (const view of this.views.values()) view.settle(); }
}
