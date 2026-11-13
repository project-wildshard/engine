import { LastPlace, type Feet, type LastPlaceSaved, type PlaceArea, type Stand } from '../../../shared/engine/quest/lastPlace';
import type { PlayerHealth } from '../../../shared/engine/combat/health';

/** The page's death fade (ui/DeathFade: dark, then the fade back): no blow lands on the fallen until then. */
export const FALL_FADE = 1.35;
/** One player's record. A save holds a player only once they have one. */
export type RespawnRow = readonly [id: string, last: LastPlaceSaved, fade: number, falls: number];

/** A record's fields. */
export interface RespawnRowFields { readonly id: string; readonly last: LastPlaceSaved; readonly fade: number; readonly falls: number }
interface Seat { readonly last: LastPlace; fade: number; falls: number; health: PlayerHealth | null }

/**
 * J107: where each player of a room goes back to. Each keeps their own last place, as the page's player does, so one player's
 * walk never moves another's return. The law is `game/roomRespawn`; this is its state, saved with company as the damage book is.
 */
export class RespawnBook {
  /** The shard's named places, set before a save is restored. */
  places: readonly PlaceArea[] = [];
  /** A net room serves a lone player too; a tape or a page's host leaves a lone death to its caller. */
  served = false;
  private readonly seats = new Map<string, Seat>();
  private seat(id: string): Seat {
    let seat = this.seats.get(id);
    if (seat === undefined) { seat = { last: new LastPlace(() => this.places), fade: 0, falls: 0, health: null }; this.seats.set(id, seat); }
    return seat;
  }
  /** Note this player's feet, a few times a second. */
  observe(id: string, feet: Feet): void {
    if (this.places.length > 0) this.seat(id).last.observe(feet);
  }
  /** Where `id` goes back to; null before they have reached a place. */
  stand(id: string): Stand | null { return this.seats.get(id)?.last.stand ?? null; }
  /** How many times `id` has fallen here. */
  falls(id: string): number { return this.seats.get(id)?.falls ?? 0; }
  /** True while `id`'s return is still fading in. */
  fading(id: string): boolean { return (this.seats.get(id)?.fade ?? 0) > 0; }
  /** Respawn now (QA 11-13): `id`'s fade ends at once, so their commands move them again. Nothing else changes. */
  skipFade(id: string): void {
    const seat = this.seats.get(id);
    if (seat !== undefined) seat.fade = 0;
  }
  /** Count a fall and start the fade its owner's health reads. */
  fell(id: string, health: PlayerHealth): void {
    const seat = this.seat(id);
    seat.falls++; seat.fade = FALL_FADE; this.bind(seat, health);
  }
  /** Bind a restored return's fade to its health. */
  rebind(id: string, health: PlayerHealth): void {
    const seat = this.seats.get(id);
    if (seat !== undefined && seat.fade > 0) this.bind(seat, health);
  }
  private bind(seat: Seat, health: PlayerHealth): void {
    if (seat.health === health) return;
    seat.health = health;
    health.bindLifecycle({ fading: () => seat.fade > 0, updateFade: dt => { seat.fade = Math.max(0, seat.fade - dt); } });
  }
  /** Drop the records of players who left. */
  keep(present: ReadonlyMap<string, unknown>): void { for (const id of this.seats.keys()) if (!present.has(id)) this.seats.delete(id); }
  /** One player's record as a save holds it, under any seat's name; null if they have none. */
  rowOf(id: string): Omit<RespawnRowFields, 'id'> | null {
    const seat = this.seats.get(id);
    return seat === undefined ? null : { last: seat.last.saved(), fade: seat.fade, falls: seat.falls };
  }
  /** Put a saved record on a seat, or clear the seat. */
  seatRow(id: string, row: Omit<RespawnRowFields, 'id'> | null): void {
    this.seats.delete(id);
    if (row === null) return;
    const seat = this.seat(id);
    seat.last.load(row.last); seat.fade = row.fade; seat.falls = row.falls;
  }
  rows(): readonly RespawnRow[] {
    return [...this.seats].filter(([, seat]) => seat.falls > 0 || seat.last.saved().inside !== null || seat.last.stand !== null).map(([id, seat]) => [id, seat.last.saved(), seat.fade, seat.falls]);
  }
  load(rows: readonly RespawnRow[]): void {
    this.seats.clear();
    for (const [id, last, fade, falls] of rows) { const seat = this.seat(id); seat.last.load(last); seat.fade = fade; seat.falls = falls; }
  }
}
