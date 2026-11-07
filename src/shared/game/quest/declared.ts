import { QuestState, type NpcDef } from '@wildshard/engine/quest/core';
import { test } from '@wildshard/engine/world/interact/flags';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { ScriptLane } from '@wildshard/engine/script/lane';
import { parseQuestData, type QuestData } from '@wildshard/format/quests';
import { questBooks, type QuestBook, type QuestBooks } from '@wildshard/engine/quest/players';

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
}
/** A live dialogue tree view; selection resolves declared flags and scenes without executing author closures. */
export interface DialogueView { id: string; lines: readonly string[]; choices: readonly { id: string; label: string }[] }
/** Bind validated quest graphs to the existing engine journal/marker state and the host's snapshot boundary. */
export class DeclaredQuests {
  readonly quests: readonly QuestState[];
  private readonly host: SimHost;
  private readonly data: QuestData;
  private readonly ports: QuestDataPorts;
  private readonly dialogue = new Map<string, string | null>();
  private readonly dialogues = new Map<string, Map<string, string | null>>();
  private readonly books: QuestBooks;
  constructor(host: SimHost, input: QuestData, ports: QuestDataPorts = {}) {
    const data = parseQuestData(input), books = questBooks(host), lead = books.lead;
    if (data.quests.some((q) => host.quests.some((existing) => existing.def.id === q.id))) throw new Error('Quest already installed');
    const needsScript = data.triggers.some((t) => t.kind === 'script') || data.quests.some((q) => q.onComplete?.scene !== undefined) || data.dialogue.some((d) => d.nodes.some((n) => n.choices.some((c) => c.scene !== undefined)));
    if (needsScript && ports.script === undefined) throw new Error('Missing admitted quest script ports');
    if (data.quests.some((q) => q.onComplete?.fact !== undefined) && ports.fact === undefined) throw new Error('Missing quest fact port');
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
      const state = new QuestState(q, host.flags, host.events, host.scope);
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
    books.lead.part(`dialogue:${data.quests[0]?.id ?? ''}`, { read: () => JSON.stringify(Object.fromEntries(this.dialogue)), write: saved => { this.restoreNodes(this.dialogue, JSON.parse(saved) as SimValue); } });
    host.events.on('actor.died', ({ actor }) => {
      // the kill counts for everyone in the room whose trigger is waiting on it
      for (const book of books.each()) for (const t of data.triggers) if (t.kind === 'death' && actor.tags.some((tag) => tag === t.tag) && test(book.flags, t.when)) book.flags.set(t.flag);
    }, host.scope);
    host.onStep('quest.declared', () => {
      for (const book of books.each()) this.watch(book);
    }, { snapshot: () => this.snapshot(), restore: (state) => { this.restore(state); } });
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
  /** Close a terminal node after its lines; choice-bearing nodes require an explicit available choice. */
  finish(id: string, player: string = this.books.lead.player): void {
    const nodes = this.nodes(player), { flags } = this.books.of(player);
    const d = this.data.dialogue.find((entry) => entry.id === id), current = nodes.get(id);
    const node = d?.nodes.find((n) => n.id === current);
    if (node === undefined || node.choices.length > 0) throw new Error('Dialogue requires an available choice');
    for (const flag of node.sets ?? []) flags.set(flag);
    nodes.set(id, null);
  }
  snapshot(): SimValue { return Object.fromEntries(this.dialogue); }
  restore(value: SimValue): void { this.restoreNodes(this.dialogue, value); }
  private restoreNodes(nodes: Map<string, string | null>, value: SimValue): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== this.data.dialogue.length) throw new Error('Invalid dialogue snapshot');
    for (const d of this.data.dialogue) {
      const current = value[d.id];
      if (current !== null && (typeof current !== 'string' || !d.nodes.some((n) => n.id === current))) throw new Error('Invalid dialogue node snapshot');
      nodes.set(d.id, current);
    }
  }
}

/** Every flag a quest row raises on the player it runs for: each keeps its own. */
function declaredFlags(data: QuestData): string[] {
  return [...data.quests.map(q => q.completeFlag), ...data.triggers.map(t => t.flag),
    ...data.dialogue.flatMap(d => d.nodes.flatMap(n => [...n.sets ?? [], ...n.choices.flatMap(c => c.sets ?? [])]))];
}
