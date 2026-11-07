import { migrateEquipmentSlots, type DeclaredMigrations } from '@wildshard/format/migrations';
import { skinSave } from '../../../shared/game/saves';
import type { WeaponId } from '@wildshard/engine/combat/Equipment';
import type { SkinDef } from '@wildshard/engine/player/Skins';
import type { SkinRow } from '@wildshard/engine/ui/Menu';
import type { SaveSlot } from '@wildshard/engine/saves/store';

export interface CosmeticState { owned: string[]; worn: Record<string, string> }
export interface CosmeticProfile<Slot extends string, Row extends { id: string }> { slot: (row: Row) => Slot; save: Pick<SaveSlot<CosmeticState>, 'read' | 'write'>; autoWear?: boolean; migrations?: DeclaredMigrations }

/** One ownership and wear service; shard profiles supply rows, persistence and auto-wear policy. */
export class CosmeticsLocker<Slot extends string, Row extends { id: string }> {
  readonly owned: Set<string> = new Set<string>();
  readonly worn: Partial<Record<Slot, string>> = {};
  private readonly rows: ReadonlyMap<string, Row>;
  version = 0;
  onChange?: (() => void) | undefined;

  constructor(private readonly namespace: string, rows: readonly Row[], private readonly profile: CosmeticProfile<Slot, Row>) {
    this.rows = new Map(rows.map((row) => [row.id, row]));
    try {
      const state = profile.save.read(namespace);
      for (const id of state.owned) if (this.rows.has(id)) this.owned.add(id);
      const worn = migrateEquipmentSlots(state.worn, profile.migrations ?? []);
      if (JSON.stringify(worn) !== JSON.stringify(state.worn)) profile.save.write({ owned: state.owned, worn }, namespace);
      for (const [slot, id] of Object.entries(worn)) {
        const row = this.rows.get(id);
        if (row !== undefined && profile.slot(row) === slot && this.owned.has(id)) this.worn[this.profile.slot(row)] = id;
      }
    } catch { /* fresh locker */ }
  }
  private save(): void {
    this.changed?.();
    this.version++;
    const worn: Record<string, string> = {};
    for (const [slot, id] of Object.entries<string | undefined>(this.worn)) if (id !== undefined) worn[slot] = id;
    try { this.profile.save.write({ owned: [...this.owned], worn }, this.namespace); } catch { /* not persisted */ }
    this.onChange?.();
  }
  protected changed?: () => void;
  has(id: string): boolean { return this.owned.has(id); }
  own(id: string): void {
    const row = this.rows.get(id);
    if (row === undefined || this.owned.has(id)) return;
    this.owned.add(id);
    if (this.profile.autoWear) this.worn[this.profile.slot(row)] ??= id;
    this.save();
  }
  wearing(slot: Slot): Row | null { const id = this.worn[slot]; return id === undefined ? null : this.rows.get(id) ?? null; }
  private wearingSlot(id: string): Slot | undefined { const row = this.rows.get(id); return row === undefined ? undefined : this.profile.slot(row); }
  wear(slot: Slot, id: string | null): void {
    if (id !== null && (!this.owned.has(id) || this.wearingSlot(id) !== slot)) return;
    if (id === null) delete this.worn[slot]; else this.worn[slot] = id;
    this.save();
  }
  /** A registered, owned cosmetic's next wear action, without saving or applying its look. */
  pick(id: string): { skin: Row; act: 'wear' | 'off' } | null {
    const skin = this.rows.get(id);
    if (skin === undefined || !this.has(id)) return null;
    return { skin, act: this.wearing(this.profile.slot(skin))?.id === id ? 'off' : 'wear' };
  }
  toggle(id: string): void {
    const pick = this.pick(id);
    if (pick !== null) this.wear(this.profile.slot(pick.skin), pick.act === 'off' ? null : id);
  }
  /** Authored card order and words, with live ownership and wear state from this locker. */
  cardRows(cards: readonly (Omit<SkinRow, 'worn' | 'locked'> & { lockedBlurb: string })[]): SkinRow[] {
    return cards.map(({ lockedBlurb, ...card }) => {
      const skin = this.rows.get(card.id);
      if (skin === undefined) throw new Error('Unregistered cosmetic card');
      const owned = this.has(card.id);
      return { ...card, blurb: owned ? card.blurb : lockedBlurb, locked: !owned,
        worn: owned && this.wearing(this.profile.slot(skin))?.id === card.id };
    });
  }
  entries(): (Row & { worn: boolean })[] {
    const entries: (Row & { worn: boolean })[] = [];
    for (const row of this.rows.values()) if (this.has(row.id)) entries.push({ ...row, worn: this.worn[this.profile.slot(row)] === row.id });
    return entries;
  }
}

/** Weapon-material profile, with the original shard-scoped save and manual wear policy. */
export class SkinLocker extends CosmeticsLocker<WeaponId, SkinDef> {
  constructor(namespace: string, rows: readonly SkinDef[] = [], migrations: DeclaredMigrations = []) {
    super(namespace, rows, { save: skinSave, slot: (row) => row.weapon, migrations });
  }
}
