/**
 * Bounty — each of a shard's enemies pays its coins once (Jake's pick on coin farming, 2026-09-30: "cap per enemy").
 * The island's enemies come back (Ecology.ts: a replacement 4–15 min after a kill, the sailor after dark, the whole
 * population on a reload), so a kill is keyed by what survives a respawn: its herd slot (`<kind>:<herd index>`, the
 * herd the replacement rejoins) or, for a lone one (herd −1: the drowned sailor, the Drowned Captain), its kind. A key
 * pays for as many deaths as the island started with in it — the starting population, counted when the loot installs —
 * and a key never seen then (the captain rises at the finale) pays once. Saved per shard ('ws.bounty.v1':
 * { key: deaths paid }), so a reload doesn't reset it.
 *
 *   const bounty = new Bounty(chunk.id, Bounty.census(animals.animals));
 *   if (bounty.claim(a)) burst(…)       // true: this death pays (and is counted, saved); false: a respawn's, no coins
 *   bounty.left(a)                      // deaths this key still pays for
 */
import { bountySave, saveSlug } from '../saves';


export interface BountyTarget { kind: string; herd: number }

export const bountyKey = (a: BountyTarget): string => (a.herd >= 0 ? `${a.kind}:${a.herd}` : a.kind);

export class Bounty {
  private paid: Record<string, number> = {};

  /** how many of each key the island starts with (the living animals when the loot installs) */
  static census(animals: readonly (BountyTarget & { alive: boolean })[]): Map<string, number> {
    const caps = new Map<string, number>();
    for (const a of animals) if (a.alive) { const k = bountyKey(a); caps.set(k, (caps.get(k) ?? 0) + 1); }
    return caps;
  }

  /** Page and native owners share the same once-per-starting-slot law. */
  constructor(readonly shard: string, private caps: ReadonlyMap<string, number>, private readonly save: Pick<typeof bountySave, 'read' | 'write'> = bountySave) {
    const saved = this.save.read(saveSlug(shard));
    for (const [k, v] of Object.entries(saved)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) this.paid[k] = Math.floor(v);
  }

  left(a: BountyTarget): number {
    const k = bountyKey(a);
    return Math.max(0, (this.caps.get(k) ?? 1) - (this.paid[k] ?? 0));
  }

  claim(a: BountyTarget): boolean {
    if (this.left(a) <= 0) return false;
    const k = bountyKey(a);
    this.paid[k] = (this.paid[k] ?? 0) + 1;
    this.save.write(this.paid, saveSlug(this.shard));
    return true;
  }
}
