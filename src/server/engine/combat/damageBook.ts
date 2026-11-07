import type { DamageRequest } from '../../../shared/engine/combat/pipeline';

/** J105: a player earns a roll by dealing at least this share of what a body took... */
export const MEANINGFUL_SHARE = 0.1;
/** ...or half an even split among those who hit it, which is less once a crowd shares a big body (J104). */
export const MEANINGFUL_SPLIT = 0.5;
/** Each wounded body's damage by player, as saved. */
export type DamageRows = readonly (readonly [string, readonly (readonly [string, number])[]])[];

/** The player behind a hit, if any: its own source, or the host's first player for a hit the world filed for it by tag. */
export function landedBy(req: DamageRequest, players: ReadonlyMap<string, unknown>): string | null {
  if (req.source !== 'env' && players.has(req.source.id)) return req.source.id;
  if (!req.sourceTags.includes('actor.player')) return null;
  const first = players.keys().next();
  return first.done === true ? null : first.value;
}

/** J105: who hurt which body, on the server. A body's page closes when it dies. */
export class DamageBook {
  private readonly bodies = new Map<string, Map<string, number>>();
  /** Note a settled hit. Only a creature keeps a page; damage past its health still counts, as the pipeline dealt it. */
  record(req: DamageRequest, dealt: number, players: ReadonlyMap<string, unknown>): void {
    if (dealt <= 0 || !req.target.tags.includes('actor.creature')) return;
    const player = landedBy(req, players); if (player === null) return;
    let page = this.bodies.get(req.target.id);
    if (page === undefined) { page = new Map(); this.bodies.set(req.target.id, page); }
    page.set(player, (page.get(player) ?? 0) + dealt);
  }
  /** What `player` has dealt `body`. */
  dealt(body: string, player: string): number { return this.bodies.get(body)?.get(player) ?? 0; }
  /** The players who earned a roll on `body`, in the order they first hit it. */
  meaningful(body: string): string[] {
    const page = this.bodies.get(body); if (page === undefined) return [];
    let total = 0; for (const amount of page.values()) total += amount;
    const bar = total * Math.min(MEANINGFUL_SHARE, MEANINGFUL_SPLIT / page.size), out: string[] = [];
    for (const [player, amount] of page) if (amount >= bar) out.push(player);
    return out;
  }
  /** Close a body's page. */
  forget(body: string): void { this.bodies.delete(body); }
  /** Drop a player who left: its share no longer raises the bar. */
  leave(player: string): void { for (const [body, page] of this.bodies) { page.delete(player); if (page.size === 0) this.bodies.delete(body); } }
  rows(): DamageRows { return [...this.bodies].map(([body, page]) => [body, [...page]]); }
  load(rows: DamageRows): void { this.bodies.clear(); for (const [body, page] of rows) this.bodies.set(body, new Map(page)); }
}
