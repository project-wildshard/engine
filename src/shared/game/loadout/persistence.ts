import * as v from 'valibot';
import { saves } from '@wildshard/engine/saves/runtime';
import type { SaveSlot, SaveStore } from '@wildshard/engine/saves/store';
import type { LoadoutRows } from '@wildshard/format/loadout';

const registered = new WeakMap<SaveStore, Map<string, { fields: string; slot: SaveSlot<Record<string, number | undefined>> }>>();
/** Register a legacy save ABI once, explicitly when installing the held loadout.
 * Field names/order come from rows; valid existing v1 documents keep the same key,
 * namespace, schema and values. Reusing a key with a different ABI refuses. */
export function loadoutLegacySlot(rows: LoadoutRows, store: SaveStore = saves): SaveSlot<Record<string, number | undefined>> {
  const fields = [...rows.pouch.kinds.filter(kind => kind !== rows.pouch.fallback), rows.persistence.firearm, rows.persistence.bow];
  if (new Set(fields).size !== fields.length) throw new Error('Duplicate loadout save field');
  let definitions = registered.get(store);
  if (definitions === undefined) { definitions = new Map(); registered.set(store, definitions); }
  const key = rows.persistence.key, fingerprint = JSON.stringify(fields), existing = definitions.get(key);
  if (existing !== undefined) { if (existing.fields !== fingerprint) throw new Error('Conflicting loadout save ABI'); return existing.slot; }
  const schema = v.object(Object.fromEntries(fields.map(field => [field, v.optional(v.pipe(v.number(), v.finite()))])));
  const slot = store.define({ key, scope: 'shard', version: rows.persistence.version, schema, initial: () => ({}) });
  definitions.set(key, { fields: fingerprint, slot }); return slot;
}
