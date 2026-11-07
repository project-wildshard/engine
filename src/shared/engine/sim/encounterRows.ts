/** Every state a fight or a lair can be in: `BossBrain`'s, then `EliteCore`'s. */
export const ENCOUNTER_STATES = ['dormant', 'armed', 'intro', 'fight', 'beat', 'victory', 'absent', 'idle', 'aware', 'engaged', 'leash', 'dead', 'broken', 'retired'] as const;

/** One boss fight or elite lair as a client sees it. Rules, clocks and scripts stay on the server. */
export interface EncounterNetView {
  readonly kind: 'boss' | 'elite'; readonly state: string; readonly hp: number;
  readonly phase: number; readonly shield: boolean; readonly body: string | null;
  /** How far a hold-to-skip has come, 0 to 1. */
  readonly skip: number;
  /** Counts of a lair's banners and signature moves: a client plays a moment when one moves. */
  readonly banners: number; readonly signatures: number;
  /** Whether a lair is on the map, and how much of its sleep is left, 0 to 1. */
  readonly known: boolean; readonly sleep: number;
  /** Where a fight's reward waits to be taken, or null. */
  readonly reward: EncounterReward | null;
}
/** A point in the cell's frame. */
export interface EncounterReward { readonly x: number; readonly y: number; readonly z: number }
/** What a row says when it has none of a fight's or a lair's moments. */
export const NO_MOMENTS: Pick<EncounterNetView, 'skip' | 'banners' | 'signatures' | 'known' | 'sleep' | 'reward'> = { skip: 0, banners: 0, signatures: 0, known: false, sleep: 0, reward: null };

/** A lair as the rules hold it, with its body as the room knows it. */
interface EliteEntryRow {
  readonly state: string; readonly phase2: boolean; readonly beatT: number;
  readonly script: { readonly animal: { readonly hp: number; readonly maxHp: number; readonly entityId: string } | null; readonly def?: { readonly respawnMin: number } };
  readonly discovered?: boolean; readonly timer?: number; readonly banners?: number; readonly signatures?: number; readonly drop?: EncounterReward | null;
}
/** A lair's row. Empty health while no body is out. */
export function eliteNetView(entry: EliteEntryRow): EncounterNetView {
  const body = entry.script.animal;
  const sleep = entry.state === 'dead' ? (entry.timer ?? 0) / ((entry.script.def?.respawnMin ?? 1) * 60) : 0;
  return { ...NO_MOMENTS, kind: 'elite', state: entry.state, hp: body === null ? 0 : body.hp / body.maxHp, phase: Number(entry.phase2), shield: entry.beatT > 0, body: body?.entityId ?? null,
    known: entry.discovered === true, sleep, banners: entry.banners ?? 0, signatures: entry.signatures ?? 0, reward: entry.drop ?? null };
}

type EncounterRead = () => EncounterNetView;
const books = new WeakMap<object, Map<string, EncounterRead>>();
const NO_ROWS: ReadonlyMap<string, EncounterRead> = new Map<string, EncounterRead>();
/** Publish an encounter's row for the host's lifetime, under a stable wire id. Read only when a room samples it; the page
 *  publishes too and never reads, so this half stays out of `net/`, which the shipped client does not reach. */
export function publishEncounter(host: { readonly scope: { readonly onDispose: (run: () => void) => unknown } }, id: string, read: EncounterRead): void {
  let book = books.get(host);
  if (book === undefined) { const fresh = new Map<string, EncounterRead>(); book = fresh; books.set(host, fresh); host.scope.onDispose(() => { fresh.clear(); }); }
  const wire = `encounter:${id}`;
  if (book.has(wire)) throw new Error(`Duplicate encounter row ${id}`);
  book.set(wire, read);
}
/** Every row a host publishes, by wire id. */
export function encounterRows(host: object): ReadonlyMap<string, EncounterRead> { return books.get(host) ?? NO_ROWS; }
