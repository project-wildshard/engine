import { QuestState, type NpcDef } from '@wildshard/engine/quest/core';
import { test } from '@wildshard/engine/world/interact/flags';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { ScriptLane } from '@wildshard/engine/script/lane';
import { parseQuestData, type QuestData } from '@wildshard/format/quests';
import { questBooks, type QuestBook, type QuestBooks } from '@wildshard/engine/quest/players';
import { FIXED_STEP } from '@wildshard/engine/core/fixedStep';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { RACE_CHIP, raceStartLine } from './raceWire';

/** Hooks read atomically published script fields or queue declared events for the next script tick. */
export interface QuestScriptPorts {
  condition: (id: string, actorId: string) => boolean;
  scene: (id: string, actorId: string) => void;
  /** Whether scripts know this actor: a room's other players have no script handle yet. */
  knows?: (actorId: string) => boolean;
}
/** Loader-resolved stable script field/event ids; actor target handles come from the session. */
export interface QuestScriptBindings {
  conditions: readonly { id: string; scope: 'shared' | 'player'; fieldId: number; equals: number }[];
  scenes: readonly { id: string; type: number; value: number }[];
}
/** Resolve conditions through public/owner state and scenes through the bounded next-tick event queue. */
export function createQuestScriptPorts(lane: Pick<ScriptLane, 'world' | 'enqueue'>, bindings: QuestScriptBindings, actors: ReadonlyMap<string, number>): QuestScriptPorts {
  const conditions = new Map(bindings.conditions.map((binding) => {
    const field = lane.world.declaration[binding.scope].find((entry) => entry.id === binding.fieldId);
    if (field === undefined || (binding.scope === 'shared' ? field.privacy !== 'public' : field.privacy === 'host') || !Number.isFinite(binding.equals) || binding.equals < field.min || binding.equals > field.max) throw new Error('Invalid published quest condition');
    return [binding.id, { ...binding, field: field.name }] as const;
  }));
  const scenes = new Map(bindings.scenes.map((binding) => [binding.id, { ...binding }]));
  if (conditions.size !== bindings.conditions.length || scenes.size !== bindings.scenes.length || bindings.scenes.some((scene) => !Number.isSafeInteger(scene.type) || scene.type < 1 || !Number.isFinite(scene.value))) throw new Error('Invalid quest script bindings');
  const target = (actorId: string): number => { const handle = actors.get(actorId); if (handle === undefined || lane.world.actor(handle) !== actorId) throw new Error('Unknown quest actor binding'); return handle; };
  return {
    knows: actorId => actors.has(actorId),
    condition: (id, actorId) => { target(actorId); const binding = conditions.get(id); if (binding === undefined) throw new Error('Unknown quest condition hook'); return lane.world.viewField(actorId, binding.scope, binding.field) === binding.equals; },
    scene: (id, actorId) => { const binding = scenes.get(id); if (binding === undefined) throw new Error('Unknown quest scene hook'); lane.enqueue({ type: binding.type, target: target(actorId), value: binding.value }); },
  };
}
/** Platform-owned fact/reward ports; authored quests never write the profile or progress store. A quest's fact is filed under the quest's id, coins under the player's. */
export interface QuestDataPorts {
  script?: QuestScriptPorts;
  fact?: (name: string, entity: string) => void;
  coins?: (quantity: number, entity: string) => void;
  /** MIRROR-SALT-ZONE MSZ31: how a player moves now, for a race that names its `ride`; without it every run is admitted. */
  ride?: (player: string) => RaceRide;
}
/** How a player moves, as a race's `ride` reads it: seated in a vehicle, on the hoverboard, or on foot. */
export type RaceRide = 'vehicle' | 'board' | 'foot';
/** A live dialogue tree view; selection resolves declared flags and scenes without executing author closures. */
export interface DialogueView { id: string; lines: readonly string[]; choices: readonly { id: string; label: string }[] }
/** One player's timed run (SHARD-SOURCE SS-MS1a2): the tick its start flag rose while running, and its last and best times in seconds.
 *  MSZ31: a race of laps or checkpoints also keeps, while running, the laps done (`lap`), the next checkpoint (`next`), the tick
 *  the lap began (`lapAt`) and the last lap's time in seconds (`split`); a plain race never has them, so its bytes stand. */
export interface RaceRun { running: number | null; last: number | null; best: number | null; runs: number; lap?: number; next?: number; lapAt?: number; split?: number }
/** A race row; MSZ31 (format 0.57.0): its `laps`, `checkpoints` and `ride`. */
type Race = NonNullable<QuestData['races']>[number];
/** MSZ31: a race counted by laps or checkpoints. */
const lapped = (race: Race): boolean => (race.laps ?? 1) > 1 || (race.checkpoints ?? []).length > 0;

const freshRun = (): RaceRun => ({ running: null, last: null, best: null, runs: 0 });
/** The lead's runs' key in the step snapshot beside its dialogue nodes. */
const LEAD_RACES = '#races';
/** Bind validated quest graphs to the existing engine journal/marker state and the host's snapshot boundary. */
export class DeclaredQuests {
  readonly quests: readonly QuestState[];
  private readonly host: SimHost;
  private readonly data: QuestData;
  private readonly ports: QuestDataPorts;
  private readonly dialogue = new Map<string, string | null>();
  private readonly dialogues = new Map<string, Map<string, string | null>>();
  private readonly books: QuestBooks;
  private readonly races = new Map<string, Map<string, RaceRun>>();
  /** MSZ31: per player and race, the last chip (a refused start, a void lap) and the tick it showed. */
  private readonly chips = new Map<string, Map<string, { readonly chip: number; readonly at: number }>>();
  constructor(host: SimHost, input: QuestData, ports: QuestDataPorts = {}) {
    const data = parseQuestData(input), books = questBooks(host), lead = books.lead;
    if (data.quests.some((q) => host.quests.some((existing) => existing.def.id === q.id))) throw new Error('Quest already installed');
    const needsScript = data.triggers.some((t) => t.kind === 'script') || data.quests.some((q) => q.onComplete?.scene !== undefined) || data.dialogue.some((d) => d.nodes.some((n) => n.choices.some((c) => c.scene !== undefined)));
    if (needsScript && ports.script === undefined) throw new Error('Missing admitted quest script ports');
    if ((data.quests.some((q) => q.onComplete?.fact !== undefined) || (data.races ?? []).length > 0) && ports.fact === undefined) throw new Error('Missing quest fact port');
    if (data.quests.some((q) => (q.onComplete?.coins ?? 0) > 0) && ports.coins === undefined) throw new Error('Missing local coin port');
    this.host = host; this.data = data; this.ports = ports; this.books = books;
    books.claim(declaredFlags(data));
    const complete = (q: QuestData['quests'][number], player: string): void => {
      if (q.onComplete?.scene !== undefined && ports.script?.knows?.(player) !== false) ports.script?.scene(q.onComplete.scene, player);
      // a quest's fact names the quest, as the page's bindRuntimeQuest files it: one ledger key headless and in the browser;
      // another player's names them both, or the ledger's dedupe would call their completion the lead's
      if (q.onComplete?.fact !== undefined) ports.fact?.(q.onComplete.fact, player === lead.player ? q.id : `${player}:${q.id}`);
      if ((q.onComplete?.coins ?? 0) > 0) ports.coins?.(q.onComplete?.coins ?? 0, player);
    };
    this.quests = data.quests.map((q) => {
      const state = new QuestState(q, lead.flags, host.events, host.scope); // SB34b: the lead's view, whose kills are its own
      host.scope.onDispose(state.observe({ complete: () => { complete(q, lead.player); } }));
      return state;
    });
    host.quests.push(...this.quests);
    for (const d of data.dialogue) this.dialogue.set(d.id, d.start);
    books.install(book => {
      for (const q of data.quests) book.adopt(q).observe({ complete: () => { complete(q, book.player); } });
      const nodes = new Map(data.dialogue.map(d => [d.id, d.start]));
      this.dialogues.set(book.player, nodes);
      book.part(`dialogue:${data.quests[0]?.id ?? ''}`, { read: () => JSON.stringify(Object.fromEntries(nodes)), write: saved => { this.restoreNodes(nodes, JSON.parse(saved) as SimValue); } });
    });
    this.installRaces(data.races ?? [], lead);
    books.lead.part(`dialogue:${data.quests[0]?.id ?? ''}`, { read: () => JSON.stringify(Object.fromEntries(this.dialogue)), write: saved => { this.restoreNodes(this.dialogue, JSON.parse(saved) as SimValue); } });
    host.events.on('actor.died', ({ actor }) => {
      // A selector names an exact spawn or one of its actor tags; credit stays per player and condition.
      for (const book of books.each()) for (const t of data.triggers) if (t.kind === 'death' && (actor.id === t.tag || actor.tags.some((tag) => tag === t.tag)) && test(book.flags, t.when)) book.flags.set(t.flag);
    }, host.scope);
    host.onStep('quest.declared', () => {
      for (const book of books.each()) { this.watch(book); this.lapseRaces(book); }
    }, { snapshot: () => this.snapshot(), restore: (state) => { this.restore(state); } });
  }
  /** SS-MS1a2: per player, the start flag rising starts the clock and the stop flag rising files the fact with the time, keeping the
   *  best; a finish or a lapse past the cap lowers both flags, so the run can be run again. The running start tick and the best (ms)
   *  are that player's owned lines `race:<id>`, with `.last` and `.best` (ms) and `.runs` (finishes); the runs ride the book's save. */
  private installRaces(races: readonly Race[], lead: QuestBook): void {
    if (races.length === 0) return;
    const bind = (book: QuestBook): void => {
      const runs = new Map(races.map(race => [race.id, freshRun()])); this.races.set(book.player, runs);
      book.flags.onChange((flag, on) => {
        if (!on || this.books.restoring) return;
        for (const race of races) {
          const run = runs.get(race.id); if (run === undefined) continue;
          if (flag === race.start) this.startRace(book, race, run);
          else if (flag === race.stop && run.running !== null) this.crossLine(book, race, run);
          else if (run.running !== null && (race.checkpoints ?? []).includes(flag)) this.checkpoint(book, race, run, flag);
        }
      });
      // the part carries a running run's elapsed ticks, not this room's tick: an imported book lands in a room with its own count
      book.part(`races:${races[0]?.id ?? ''}`, {
        read: () => JSON.stringify(Object.fromEntries([...runs].map(([id, run]) => [id, { ...run, running: run.running === null ? null : this.host.state.tick - run.running,
          ...(run.lapAt === undefined ? {} : { lapAt: this.host.state.tick - run.lapAt }) }]))),
        write: saved => {
          restoreRuns(runs, races, JSON.parse(saved) as SimValue);
          for (const run of runs.values()) { if (run.running !== null) run.running = this.host.state.tick - run.running; if (run.lapAt !== undefined) run.lapAt = this.host.state.tick - run.lapAt; }
        },
      });
    };
    bind(lead); this.books.install(bind);
    publishOwned(this.host, 'quest.races', (player, out) => {
      for (const [id, run] of this.races.get(player) ?? []) {
        if (run.running !== null) out.set(`race:${id}`, raceStartLine(run.running));
        if (run.last !== null) out.set(`race:${id}.last`, Math.round(run.last * 1000));
        if (run.best !== null) out.set(`race:${id}.best`, Math.round(run.best * 1000));
        if (run.runs > 0) out.set(`race:${id}.runs`, run.runs);
        if (run.running !== null && run.lap !== undefined) out.set(`race:${id}.lap`, run.lap + 1);
        if (run.running !== null && run.split !== undefined) out.set(`race:${id}.split`, Math.round(run.split * 1000));
        const chip = this.chips.get(player)?.get(id);
        if (chip !== undefined) { out.set(`race:${id}.chip`, chip.chip); out.set(`race:${id}.chipAt`, raceStartLine(chip.at)); }
      }
    });
  }
  /** The start flag rose: a run begun the wrong way (`ride`) is refused with a chip and its start lowered; else the clock starts
   *  over and a run counts only the gates and checkpoints crossed in it. */
  private startRace(book: QuestBook, race: Race, run: RaceRun): void {
    const ride = race.ride ?? 'any', moving = ride === 'any' ? null : this.ports.ride?.(book.player) ?? null;
    if (moving !== null && moving !== ride) {
      this.chip(book.player, race, ride === 'vehicle' ? RACE_CHIP.vehicle : RACE_CHIP.foot);
      run.running = null; clearLaps(run); lowerRun(book, race); return;
    }
    run.running = this.host.state.tick; clearLaps(run);
    if (lapped(race)) Object.assign(run, { lap: 0, next: 0, lapAt: this.host.state.tick });
    for (const lowered of [race.stop, ...race.resets ?? [], ...race.checkpoints ?? []]) book.flags.set(lowered, false);
  }
  /** MSZ31: a checkpoint crossed in order counts; out of order it is lowered again. The lap's first one lowers the line's stop,
   *  which stays up from the lap before so standing on the line counts nothing. */
  private checkpoint(book: QuestBook, race: Race, run: RaceRun, flag: string): void {
    const checkpoints = race.checkpoints ?? [], at = checkpoints.indexOf(flag), next = run.next ?? 0;
    if (at !== next) { book.flags.set(flag, false); return; }
    run.next = next + 1;
    if (at === 0) book.flags.set(race.stop, false);
  }
  /** The stop flag rose on a running run: a plain race finishes; a lapped one counts the lap if every checkpoint was crossed in
   *  order, else voids it with a chip, and finishes after its last lap. */
  private crossLine(book: QuestBook, race: Race, run: RaceRun): void {
    if (!lapped(race)) { this.finishRace(book, race, run); return; }
    const checkpoints = race.checkpoints ?? [], tick = this.host.state.tick;
    for (const flag of checkpoints) book.flags.set(flag, false);
    if ((run.next ?? 0) < checkpoints.length) { this.chip(book.player, race, RACE_CHIP.void); Object.assign(run, { next: 0, lapAt: tick }); return; }
    const lap = (run.lap ?? 0) + 1;
    Object.assign(run, { lap, next: 0, split: (tick - (run.lapAt ?? tick)) * FIXED_STEP, lapAt: tick });
    if (lap >= (race.laps ?? 1)) this.finishRace(book, race, run);
    else if (checkpoints.length === 0) book.flags.set(race.stop, false);
  }
  private chip(player: string, race: Race, chip: number): void {
    const chips = this.chips.get(player) ?? new Map<string, { chip: number; at: number }>(); this.chips.set(player, chips);
    chips.set(race.id, { chip, at: this.host.state.tick });
  }
  private finishRace(book: QuestBook, race: Race, run: RaceRun): void {
    const seconds = (this.host.state.tick - (run.running ?? this.host.state.tick)) * FIXED_STEP;
    run.running = null; run.last = seconds; run.best = run.best === null ? seconds : Math.min(run.best, seconds); run.runs++; clearLaps(run);
    lowerRun(book, race);
    this.ports.fact?.(race.fact, book.player === this.books.lead.player ? race.id : `${book.player}:${race.id}`);
  }
  /** A run past its cap lapses: nothing is filed and its start flag drops so it can begin again. */
  private lapseRaces(book: QuestBook): void {
    const runs = this.races.get(book.player); if (runs === undefined) return;
    for (const race of this.data.races ?? []) {
      const run = runs.get(race.id);
      if (run === undefined || run.running === null || (this.host.state.tick - run.running) * FIXED_STEP <= race.cap) continue;
      run.running = null; clearLaps(run); lowerRun(book, race);
    }
  }
  /** One player's run of a race, or null for an unknown race or player. */
  race(id: string, player: string = this.books.lead.player): RaceRun | null {
    const run = this.races.get(player)?.get(id); return run === undefined ? null : { ...run };
  }
  /** One player's region and script triggers, for this tick. */
  private watch(book: QuestBook): void {
    const position = this.host.players.get(book.player)?.position, { flags } = book, script = this.ports.script;
    if (position === undefined) return;
    for (const t of this.data.triggers) {
      if (flags.has(t.flag) || !test(flags, t.when)) continue;
      if (t.kind === 'region' && Math.hypot(position.x - t.x, position.z - t.z) < t.radius) flags.set(t.flag);
      if (t.kind === 'script' && script?.knows?.(book.player) !== false && script?.condition(t.condition, book.player)) flags.set(t.flag);
    }
  }
  private nodes(player: string | undefined): Map<string, string | null> {
    if (player === undefined || player === this.books.lead.player) return this.dialogue;
    this.books.of(player);
    const nodes = this.dialogues.get(player); if (nodes === undefined) throw new Error('Unknown dialogue player'); return nodes;
  }
  view(id: string, player?: string): DialogueView | null {
    const d = this.data.dialogue.find((entry) => entry.id === id); if (d === undefined) throw new Error('Unknown dialogue');
    const current = this.nodes(player).get(id); if (current === null) return null;
    const node = d.nodes.find((n) => n.id === current); if (node === undefined) throw new Error('Unknown dialogue state');
    const flags = this.books.of(player ?? this.books.lead.player).flags;
    return { id: node.id, lines: node.lines, choices: node.choices.filter((c) => test(flags, c.when)).map((c) => ({ id: c.id, label: c.label })) };
  }
  /** Existing NPC rendering consumes the current node through its unchanged NpcDef contract. */
  npc(id: string, player?: string): NpcDef {
    const d = this.data.dialogue.find((entry) => entry.id === id); if (d === undefined) throw new Error('Unknown dialogue');
    const view = this.view(id, player); return { id, name: d.name, dialogue: view === null ? [] : [{ lines: [...view.lines] }] };
  }
  choose(id: string, choiceId: string, player: string = this.books.lead.player): void {
    const nodes = this.nodes(player), { flags } = this.books.of(player);
    const d = this.data.dialogue.find((entry) => entry.id === id), current = nodes.get(id);
    const node = d?.nodes.find((n) => n.id === current), choice = node?.choices.find((c) => c.id === choiceId);
    if (node === undefined || choice === undefined || !test(flags, choice.when)) throw new Error('Dialogue choice unavailable');
    if (choice.scene !== undefined && this.ports.script?.knows?.(player) !== false) this.ports.script?.scene(choice.scene, player);
    for (const flag of [...(node.sets ?? []), ...(choice.sets ?? [])]) flags.set(flag);
    nodes.set(id, choice.next);
  }
  /** A new conversation starts at the tree's entry; a saved null closes only the previous conversation. */
  reopen(id: string, player: string = this.books.lead.player): void {
    const tree = this.data.dialogue.find(row => row.id === id); if (tree === undefined) throw new Error('Unknown dialogue');
    const nodes = this.nodes(player);
    if (nodes.get(id) === null) nodes.set(id, tree.start);
  }
  /** Close a terminal node after its lines; choice-bearing nodes require an explicit available choice. */
  finish(id: string, player: string = this.books.lead.player): void {
    const nodes = this.nodes(player), { flags } = this.books.of(player);
    const d = this.data.dialogue.find((entry) => entry.id === id), current = nodes.get(id);
    const node = d?.nodes.find((n) => n.id === current);
    if (node === undefined || node.choices.length > 0) throw new Error('Dialogue requires an available choice');
    for (const flag of node.sets ?? []) flags.set(flag);
    nodes.set(id, null);
  }
  /** The lead's dialogue nodes and, when the shard declares races, the lead's runs under `#races` (no dialogue id starts
   *  with `#`): a one-player region save holds no book parts, so a run the lead had going finishes after a restore. */
  snapshot(): SimValue {
    const dialogue = Object.fromEntries(this.dialogue), runs = this.races.get(this.books.lead.player);
    return runs === undefined ? dialogue : { ...dialogue, [LEAD_RACES]: Object.fromEntries([...runs].map(([id, run]) => [id, { ...run }])) };
  }
  restore(value: SimValue): void {
    const runs = this.races.get(this.books.lead.player);
    if (runs === undefined || value === null || typeof value !== 'object' || Array.isArray(value) || !(LEAD_RACES in value)) { this.restoreNodes(this.dialogue, value); return; }
    const { [LEAD_RACES]: saved = null, ...dialogue } = value;
    restoreRuns(runs, this.data.races ?? [], saved); this.restoreNodes(this.dialogue, dialogue);
  }
  private restoreNodes(nodes: Map<string, string | null>, value: SimValue): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== this.data.dialogue.length) throw new Error('Invalid dialogue snapshot');
    for (const d of this.data.dialogue) {
      const current = value[d.id];
      if (current !== null && (typeof current !== 'string' || !d.nodes.some((n) => n.id === current))) throw new Error('Invalid dialogue node snapshot');
      nodes.set(d.id, current);
    }
  }
}

const timeOrNull = (value: SimValue | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid race snapshot');
  return value;
};
/** A run's end lowers its start, its stop, its resets (a gate line's middle gates, SS-MS1c) and its checkpoints (MSZ31), so the
 *  next run counts them again. */
function lowerRun(book: QuestBook, race: Race): void {
  for (const flag of [race.start, race.stop, ...(race.resets ?? []), ...(race.checkpoints ?? [])]) book.flags.set(flag, false);
}
/** MSZ31: a run that is not running keeps no lap. */
function clearLaps(run: RaceRun): void { delete run.lap; delete run.next; delete run.lapAt; delete run.split; }
/** MSZ31: a saved lapped run's lap fields, each a whole count or a tick or time at or past zero. */
function savedLaps(row: Readonly<Record<string, SimValue>>): Pick<RaceRun, 'lap' | 'next' | 'lapAt' | 'split'> {
  const out: Pick<RaceRun, 'lap' | 'next' | 'lapAt' | 'split'> = {};
  for (const key of ['lap', 'next', 'lapAt', 'split'] as const) {
    const value = row[key]; if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key !== 'split' && !Number.isSafeInteger(value))) throw new Error('Invalid race snapshot');
    out[key] = value;
  }
  return out;
}
/** A saved book's runs; a race the save does not name starts fresh. */
function restoreRuns(runs: Map<string, RaceRun>, races: readonly Race[], value: SimValue): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid race snapshot');
  for (const race of races) {
    const row = value[race.id];
    if (row === undefined) { runs.set(race.id, freshRun()); continue; }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid race snapshot');
    const finished = row['runs'] ?? 0;
    if (typeof finished !== 'number' || !Number.isSafeInteger(finished) || finished < 0) throw new Error('Invalid race snapshot');
    runs.set(race.id, { running: timeOrNull(row['running']), last: timeOrNull(row['last']), best: timeOrNull(row['best']), runs: finished, ...savedLaps(row) });
  }
}

/** Every flag a quest row raises on the player it runs for: each keeps its own. */
function declaredFlags(data: QuestData): string[] {
  return [...data.quests.map(q => q.completeFlag), ...data.triggers.map(t => t.flag), ...(data.races ?? []).flatMap(race => [race.start, race.stop].concat(race.checkpoints ?? [])),
    ...data.dialogue.flatMap(d => d.nodes.flatMap(n => [...n.sets ?? [], ...n.choices.flatMap(c => c.sets ?? [])]))];
}
