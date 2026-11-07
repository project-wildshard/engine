import type { Board } from '../quest/contracts';

/** The lines a client reads of what its player holds: the purse's coins, a pack's item by id, gear by id. */
export const OWNED_ROW = { coins: 'coins', item: 'item.', owned: 'own.', board: 'board.', slot: 'board|', said: 'said.', prop: 'story.prop', tie: 'arena.tie', arrows: 'held.arrows' } as const;
/** A gear line's value when the cosmetic is on. */
export const WORN_LINE = 2;
/** A contract board's numbers, and a line per slot naming its contract, whose value is how much of it is done, plus one so none reads 0. */
export function boardLines(board: Board, out: Map<string, number>): void {
  out.set(`${OWNED_ROW.board}next`, board.next + 1); out.set(`${OWNED_ROW.board}claimed`, board.claimed + 1); out.set(`${OWNED_ROW.board}streak`, board.streak + 1); out.set(`${OWNED_ROW.board}best`, board.best + 1);
  board.slots.forEach((slot, at) => { out.set(`${OWNED_ROW.slot}${String(at)}|${String(slot.serial)}|${slot.kind}|${slot.target}`, slot.have + 1); });
}
/** The board's saved form from its lines, or null with no board among them. */
export function boardFromLines(lines: ReadonlyMap<string, number>): string | null {
  const read = (name: string): number | undefined => { const value = lines.get(`${OWNED_ROW.board}${name}`); return value === undefined ? undefined : value - 1; }, next = read('next');
  if (next === undefined) return null;
  const slots: { at: number; serial: number; kind: string; target: string; have: number }[] = [];
  for (const [name, value] of lines) {
    if (!name.startsWith(OWNED_ROW.slot)) continue;
    const [, at = '0', serial = '0', kind = '', target = ''] = name.split('|');
    slots.push({ at: Number(at), serial: Number(serial), kind, target, have: value - 1 });
  }
  slots.sort((a, b) => a.at - b.at);
  return JSON.stringify({ next, slots: slots.map(({ at: _at, ...slot }) => slot), claimed: read('claimed') ?? 0, streak: read('streak') ?? 0, best: read('best') ?? 0 });
}
