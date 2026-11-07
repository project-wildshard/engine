/** J105 for a boss's own reward: its coins or orb go to everyone with meaningful damage, each once, through the same damage
 *  book and ledger dedupe as a creature's personal roll (loot/personal.ts). A served world is a room with one player in it, who
 *  earned it alone. Only a page's own world holds nothing and pays nothing here: its lone player's reward is the row's, unread. */
import type { SimHost } from '@wildshard/engine/sim';

interface BountyBody { readonly entityId: string; readonly combatActor: () => unknown }
export class BossBounty {
  private earners: readonly string[] = [];
  constructor(private readonly host: SimHost, body: () => BountyBody | null, private readonly key: string) {
    // The book's page closes on the death, so read it from the killing blow, which comes first.
    host.events.on('damage.dealt', ({ req, killed }) => {
      const actor = body();
      if (killed && actor !== null && req.target === actor.combatActor() && this.room) this.earners = host.damage.meaningful(actor.entityId);
    }, host.scope);
  }
  get room(): boolean { return this.host.players.size > 1 || this.host.respawn.served; }
  private paid(player: string): string { return `loot:${player}:boss:${this.key}`; }
  /** Name who earned it where the body is no creature in the book (a heart): those there at the end. */
  award(players: readonly string[]): void { this.earners = [...players]; }
  /** Those who earned it and have not had it, in the order they first hit. */
  get owed(): readonly string[] {
    const earners = this.earners.length === 0 && this.host.players.size === 1 ? [...this.host.players.keys()] : this.earners;
    return earners.filter(player => !this.host.slots.ledgerDedupe.includes(this.paid(player)));
  }
  /** One player takes their share: false when they earned none or had it. */
  take(player: string): boolean {
    if (!this.owed.includes(player)) return false;
    this.host.slots.ledgerDedupe.push(this.paid(player)); return true;
  }
  /** Coins to each earner, in the tick's ledger effects, with the event only they get. */
  pay(amount: number, grant: (player: string) => void, body: string): void {
    for (const player of this.owed) if (this.take(player)) { grant(player); this.host.events.emit('reward.granted', { player, coins: amount, body }); }
  }
  /** A kill and its victory can straddle a save. */
  get earned(): readonly string[] { return this.earners; }
  restore(earners: readonly string[]): void { this.earners = earners; }
}
