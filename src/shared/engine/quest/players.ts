import type { SimHost } from '../../../server/engine/sim';
import { Flags, type FlagListener } from '../world/interact/flags';
import { QuestState, type QuestDef } from './core';
import type { QuestProgress } from './progress';

/**
 * P1-E3.3: one player's flags over the world's. A flag a quest row writes (`QuestBooks.claim`) is that player's own; any
 * other flag in the host's book was raised by the world (a death, a boss's fall, a timed rule) and everyone reads it. The
 * lead's book stays the host's, so a one-player room is exactly today's. A write here is always the player's own.
 */
export class PlayerFlags extends Flags {
  private readonly world: Flags;
  private readonly claimed: ReadonlySet<string>;
  constructor(world: Flags, claimed: ReadonlySet<string>) { super(world.level, false); this.world = world; this.claimed = claimed; }
  private seesWorld(flag: string): boolean { return !this.claimed.has(flag) && this.world.has(flag); }
  /** What this player raised, not what it reads from the world: its save. */
  get own(): string[] { return super.all; }
  override has(flag: string): boolean { return super.has(flag) || this.seesWorld(flag); }
  override get all(): string[] { return [...new Set([...super.all, ...this.world.all.filter(flag => !this.claimed.has(flag))])]; }
  override count(prefix: string): number { let n = 0; for (const flag of this.all) if (flag.startsWith(prefix)) n++; return n; }
  override onChange(fn: FlagListener): () => void {
    const own = super.onChange(fn), world = this.world.onChange((flag, on) => { if (!this.claimed.has(flag) && !super.has(flag)) fn(flag, on); });
    return () => { own(); world(); };
  }
}

/** One player's continuation beside its flags; `read` and `write` carry detached JSON text. */
export interface QuestBookPart { readonly read: () => string; readonly write: (saved: string) => void }
/** What a saved book holds. */
export interface QuestBookSaved { player: string; flags: string[]; quests: ReturnType<QuestState['snapshot']>[]; parts: Record<string, string> }
/** One player's quest state. */
export class QuestBook {
  readonly player: string;
  readonly flags: Flags;
  readonly quests: QuestState[];
  private readonly parts = new Map<string, QuestBookPart>();
  /** Rises whenever these flags change: what a replication view compares. */
  version = 0;
  private readonly unwatch: () => void;
  constructor(player: string, flags: Flags, quests: QuestState[]) {
    this.player = player; this.flags = flags; this.quests = quests;
    this.unwatch = flags.onChange(() => { this.version++; });
  }
  /** Add a quest to this book; the lead's are the host's own. */
  adopt(def: QuestDef): QuestState { const state = new QuestState(def, this.flags); this.quests.push(state); return state; }
  /** Register a quest owner's per-player continuation. */
  part(id: string, part: QuestBookPart): void { if (this.parts.has(id)) throw new Error(`Duplicate quest book part ${id}`); this.parts.set(id, part); }
  save(): QuestBookSaved {
    if (!(this.flags instanceof PlayerFlags)) throw new Error('The lead\'s book is the host\'s');
    return { player: this.player, flags: this.flags.own.sort((a, b) => a.localeCompare(b)), quests: this.quests.map(quest => quest.snapshot()),
      parts: Object.fromEntries([...this.parts].map(([id, part]) => [id, part.read()])) };
  }
  /** Each part's text, as `restore` reads them. */
  exported(): Record<string, string> { return Object.fromEntries([...this.parts].map(([id, part]) => [id, part.read()])); }
  restore(saved: QuestBookSaved): void {
    if (saved.quests.length !== this.quests.length || Object.keys(saved.parts).some(id => !this.parts.has(id))) throw new RangeError('Snapshot quest book does not match');
    this.flags.restore(saved.flags);
    for (const quest of this.quests) { const state = saved.quests.find(row => row.id === quest.def.id); if (state === undefined) throw new RangeError('Snapshot quest book does not match'); quest.restore(state); }
    for (const [id, part] of this.parts) { const value = saved.parts[id]; if (value !== undefined) part.write(value); }
    this.version++;
  }
  dispose(): void { this.unwatch(); for (const quest of this.quests) quest.dispose(); }
}

/** What a player's client reads: its quests, and which of its own flags are up: a personal flag reaches nobody else. */
export interface QuestProgressRead { readonly version: number; readonly rows: readonly QuestProgress[]; readonly flags: readonly string[] }
/** Every player's book on one host, made as a player is first read. */
export class QuestBooks {
  /** The first player's book is the host's flags and quests. */
  readonly lead: QuestBook;
  private readonly host: Pick<SimHost, 'flags' | 'quests' | 'players' | 'level'>;
  private readonly claimed = new Set<string>();
  private readonly shown = new Set<string>();
  /** A book made now is being read back from a save. */
  restoring = false;
  private readonly books = new Map<string, QuestBook>();
  private readonly owners: ((book: QuestBook) => void)[] = [];
  private readonly list: QuestBook[] = [];
  constructor(host: Pick<SimHost, 'flags' | 'quests' | 'players' | 'level'>) {
    const [first] = host.players.keys();
    if (first === undefined) throw new Error('Quest books require a player');
    this.host = host; this.lead = new QuestBook(first, host.flags, host.quests);
    this.books.set(this.lead.player, this.lead);
    this.claim(host.level.quests.flatMap(questFlags));
    // A marker hides on a flag, and a client draws markers: it is told those flags as it is told a gate's.
    this.show(host.level.quests.flatMap(markerFlags));
  }
  /** Name flags a client must read to draw its own world (J106): an open gate, a taken key. */
  show(flags: Iterable<string>): void { for (const flag of flags) this.shown.add(flag); }
  /** Name flags that quest rows write: each player keeps its own copy of them. */
  claim(flags: Iterable<string>): void { for (const flag of flags) this.claimed.add(flag); }
  /** Whether a flag is a player's own, not the world's. */
  personal(flag: string): boolean { return this.claimed.has(flag); }
  /** Run for every other player's book, now and as they join: an owner's state for that player. */
  install(owner: (book: QuestBook) => void): void {
    this.owners.push(owner);
    for (const book of this.books.values()) if (book !== this.lead) owner(book);
  }
  of(id: string): QuestBook {
    const known = this.books.get(id);
    if (known !== undefined) return known;
    if (!this.host.players.has(id)) throw new RangeError(`Unknown quest player ${id}`);
    const flags = new PlayerFlags(this.host.flags, this.claimed), book = new QuestBook(id, flags, this.host.level.quests.map(def => new QuestState(def, flags)));
    this.books.set(id, book);
    for (const owner of this.owners) owner(book);
    return book;
  }
  /** Every present player's book, lead first; a reused list. A book whose player left goes with it. */
  each(): readonly QuestBook[] {
    for (const [id, book] of this.books) if (!this.host.players.has(id)) { book.dispose(); this.books.delete(id); }
    this.list.length = 0;
    for (const id of this.host.players.keys()) this.list.push(this.of(id));
    return this.list;
  }
  /** What one player's client is told, when its book moved past `since`. */
  progressOf(id: string, since: number): QuestProgressRead | null {
    if (!this.host.players.has(id)) return null;
    const book = this.of(id), { flags } = book;
    return book.version === since ? null : { version: book.version, rows: book.quests.map(quest => quest.progress()), flags: [...new Set([...this.shown, ...this.claimed])].filter(flag => flags.has(flag)) };
  }
  /** One player's book as any seat can read it back (E7.4): what a player carries out of a room, whichever seat they held. */
  exportOf(id: string): QuestBookSaved {
    const book = this.of(id), own = book.flags instanceof PlayerFlags ? book.flags.own : book.flags.all.filter(flag => this.personal(flag));
    return { player: id, flags: own.sort((a, b) => a.localeCompare(b)), quests: book.quests.map(quest => quest.snapshot()), parts: book.exported() };
  }
  /** Put an exported book on this player's seat. The lead's flags are the world's too, and those stay; a saved flag is theirs wherever they sit. */
  importOf(id: string, saved: QuestBookSaved): void {
    const book = this.of(id);
    this.claim(saved.flags);
    this.restoring = true;
    try { book.restore(book === this.lead ? { ...saved, flags: [...book.flags.all.filter(flag => !this.personal(flag)), ...saved.flags] } : saved); } finally { this.restoring = false; }
  }
  /** Every other player's book, or undefined: a one-player save never holds this. */
  save(): QuestBookSaved[] | undefined {
    const books = this.each().filter(book => book !== this.lead);
    return books.length === 0 ? undefined : books.map(book => book.save());
  }
  restore(saved: readonly QuestBookSaved[] | undefined): void {
    this.restoring = true;
    try { for (const row of saved ?? []) this.of(row.player).restore(row); } finally { this.restoring = false; }
  }
}

/** The host's books; the host saves them from here on. */
export function questBooks(host: Pick<SimHost, 'flags' | 'quests' | 'players' | 'level' | 'questStore'>): QuestBooks {
  const held = host.questStore;
  if (held instanceof QuestBooks) return held;
  const books = new QuestBooks(host);
  host.questStore = books;
  return books;
}
/** Every flag one quest row raises on its player. */
export function questFlags(def: QuestDef): string[] { return [def.completeFlag]; }
/** The flags a quest's markers hide on. */
function markerFlags(def: QuestDef): string[] {
  const flags: string[] = [];
  for (const marker of [...def.intro?.markers ?? [], ...def.steps.flatMap(step => step.markers ?? [])]) {
    const when = marker.hideWhen;
    if (when !== undefined) flags.push(...when.all ?? [], ...when.any ?? [], ...when.none ?? []);
  }
  return flags;
}
