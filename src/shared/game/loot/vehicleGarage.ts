/**
 * MIRROR-SALT-ZONE MSZ19: what a player keeps of vehicles on one shard, in their own save (`vehicleGarageSave`, the player's
 * `SaveStore` document on a dedicated server). A vehicle itself is never kept: a dock makes it. Kept: the kinds and colours
 * unlocked, and the kind last picked at a dock, so a garage (MSZ26) offers what was won and starts on what was driven.
 *
 *   const garage = new VehicleGarage('mirror-salt', slots.vehicles);
 *   garage.unlock('buggy')                 // true the first time
 *   garage.unlockColour('buggy', 'red')    // a colour of an unlocked kind; unlocks the kind too
 *   garage.pick('buggy')                   // the kind a dock last gave this player
 *   garage.has('buggy'); garage.colours('buggy'); garage.last
 */
import { saveSlug, vehicleGarageSave, type VehicleGarageState } from '../saves';

/** A kind or colour id, as the format writes ids. */
const ID = /^[a-z][a-z0-9.-]*$/u;
/** Bounds that keep a doc small: the format's 8 kinds a shard, with room for a renamed one, and 16 colours a kind. */
const MAX_KINDS = 16, MAX_COLOURS = 16;

export class VehicleGarage {
  private readonly kinds = new Set<string>();
  private readonly paints = new Map<string, Set<string>>();
  private picked: string | null = null;
  private readonly slug: string;
  /** The page's own save, or a player's slot on a server. */
  private readonly save: Pick<typeof vehicleGarageSave, 'read' | 'write'>;
  constructor(shard: string, save: Pick<typeof vehicleGarageSave, 'read' | 'write'> = vehicleGarageSave) {
    this.save = save;
    this.slug = saveSlug(shard);
    const saved = save.read(this.slug);
    for (const kind of saved.kinds) if (ID.test(kind) && this.kinds.size < MAX_KINDS) this.kinds.add(kind);
    for (const [kind, colours] of Object.entries(saved.colours)) {
      if (!this.kinds.has(kind)) continue;
      this.paints.set(kind, new Set(colours.filter(colour => ID.test(colour)).slice(0, MAX_COLOURS)));
    }
    this.picked = saved.last !== null && ID.test(saved.last) ? saved.last : null;
  }
  /** Whether this kind is unlocked. */
  has(kind: string): boolean { return this.kinds.has(kind); }
  /** Every unlocked kind, in the order they were unlocked. */
  get all(): readonly string[] { return [...this.kinds]; }
  /** A kind's unlocked colours. */
  colours(kind: string): readonly string[] { return [...this.paints.get(kind) ?? []]; }
  /** The kind last picked at a dock, or none yet. */
  get last(): string | null { return this.picked; }
  /** Unlock a kind: true the first time. */
  unlock(kind: string): boolean {
    if (!ID.test(kind)) throw new Error(`Unknown vehicle kind id: ${kind}`);
    if (this.kinds.has(kind) || this.kinds.size >= MAX_KINDS) return false;
    this.kinds.add(kind); this.write(); return true;
  }
  /** Unlock a colour of a kind (and the kind with it): true the first time. */
  unlockColour(kind: string, colour: string): boolean {
    if (!ID.test(colour)) throw new Error(`Unknown vehicle colour id: ${colour}`);
    const kindNew = this.unlock(kind);
    if (!this.kinds.has(kind)) return false;
    const paints = this.paints.get(kind) ?? new Set<string>();
    if (paints.has(colour) || paints.size >= MAX_COLOURS) return kindNew;
    paints.add(colour); this.paints.set(kind, paints); this.write(); return true;
  }
  /** The kind a dock gave this player last. */
  pick(kind: string): void {
    if (!ID.test(kind) || this.picked === kind) return;
    this.picked = kind; this.write();
  }
  /** What is kept, as the save holds it. */
  snapshot(): VehicleGarageState {
    return { kinds: [...this.kinds], colours: Object.fromEntries([...this.paints].map(([kind, paints]) => [kind, [...paints]])), last: this.picked };
  }
  private write(): void { this.save.write(this.snapshot(), this.slug); }
}
