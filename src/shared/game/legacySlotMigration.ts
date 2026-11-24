/**
 * FORMAT-PRUNE FP22c: the save migration that lets a shard drop `legacySlot`. A worn-skin save (`skinSave.worn`) is keyed by
 * a weapon's runtime id; while a row names the closed `legacySlot` that id is the slot (`bow`), and once the row drops it the
 * id is its item's (`declared.weapon.longbow`, FP22b's `weaponIdOf`). The step this builds renames each slot to that id
 * through the existing `equipmentSlots` migration (`migrateEquipmentSlots`, read by `SkinLocker`), so a shard declares it in
 * its `state/migrations` in the same revision that drops the slots (FP22d). Additive and reversible: a save with no step
 * reads as before, a renamed key keeps its value, the canonical key wins when both exist, and `renameSlots(worn,
 * reversed(renames))` takes a migrated save back to slots for a revision that still names them (the format only declares
 * renames toward `declared.weapon.*`, so the way back is this pure function, not a declared step).
 *
 *   const step = legacySlotMigration(items.rows, 3);   // { from: 3, to: 4, fields: [], equipmentSlots: [{ from: 'bow', to: 'declared.weapon.longbow' }] }
 */
import { weaponIdOf } from '@wildshard/engine/combat/Equipment';
import { parseMigrations, type DeclaredMigrations } from '@wildshard/format/migrations';

/** One saved slot key renamed. */
export interface SlotRename { readonly from: string; readonly to: string }
/** The parts of an item row the rename reads. */
export interface SlottedItemRow { readonly kind: string; readonly id: string; readonly equipment?: Readonly<{ id: string; legacySlot?: string | undefined }> | undefined }
type MigrationStep = DeclaredMigrations[number];

/** Each weapon's closed slot renamed to the id it plays under without one. Two weapons naming one slot is refused: a save
 *  keyed by that slot could not say whose skin it holds. */
export function legacySlotRenames(rows: readonly SlottedItemRow[]): SlotRename[] {
  const renames: SlotRename[] = [], seen = new Map<string, string>();
  for (const row of rows) {
    const slot = row.kind === 'weapon' ? row.equipment?.legacySlot : undefined;
    if (slot === undefined || row.equipment === undefined) continue;
    const owner = seen.get(slot);
    if (owner !== undefined) throw new Error(`Weapons ${owner} and ${row.id} both name legacySlot ${slot}`);
    seen.set(slot, row.id);
    // the id the weapon plays under once the slot goes is its item's (the kit keys it by the row's `slot`, `declared.<item>`)
    renames.push({ from: slot, to: weaponIdOf({ id: row.id }) });
  }
  return renames;
}

/** The migration step a shard declares when its weapons drop `legacySlot` (`from` is its current state version), checked by
 *  the format's own schema (a rename lands only on a `declared.weapon.*` key). */
export function legacySlotMigration(rows: readonly SlottedItemRow[], from: number): MigrationStep {
  const [step] = parseMigrations([{ from, to: from + 1, fields: [], equipmentSlots: legacySlotRenames(rows) }]);
  if (step === undefined) throw new Error('Legacy slot migration parsed to nothing');
  return step;
}

/** The same renames the other way, to read a migrated save on an engine or revision that still names the slots. */
export function reversed(renames: readonly SlotRename[]): SlotRename[] {
  return renames.map(rename => ({ from: rename.to, to: rename.from }));
}

/** Saved keys renamed with `migrateEquipmentSlots`'s law: a key already present wins, other keys stay as they are. */
export function renameSlots(worn: Readonly<Record<string, string>>, renames: readonly SlotRename[]): Record<string, string> {
  const out = { ...worn };
  for (const { from, to } of renames) {
    const value = out[from];
    if (!Object.hasOwn(out, from) || value === undefined) continue;
    if (!Object.hasOwn(out, to)) out[to] = value;
    delete out[from];
  }
  return out;
}
