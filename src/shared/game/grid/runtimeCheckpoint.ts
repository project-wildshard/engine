import * as v from 'valibot';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { instanceSave, type LocalSaveInstance } from '../instanceSaves';

const finite = v.pipe(v.number(), v.finite());
const health = v.pipe(finite, v.minValue(0), v.maxValue(1_000_000_000));
// Native WORLD falls can pass below the finite border walls, then continue horizontally in the void.
// AnimalSim.restore accepts every finite native position; the continuation preserves that law without clamping.
const actor = v.strictObject({ id: v.pipe(v.string(), v.minLength(1), v.maxLength(160)),
  kind: v.pipe(v.string(), v.minLength(1), v.maxLength(160)), hp: health, maxHp: health, alive: v.boolean(),
  x: finite, y: finite, z: finite, yaw: finite });
const schema = v.nullable(v.strictObject({ revision: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  actors: v.pipe(v.array(actor), v.maxLength(4096), v.check(rows => new Set(rows.map(row => row.id)).size === rows.length
    && rows.every(row => row.hp <= row.maxHp && row.alive === (row.hp > 0)), 'Invalid runtime creature continuation')) }));
const definition = { key: 'platform.runtime-logical', scope: 'shard' as const, version: 1, schema, initial: () => null };
interface Creatures { readonly animals: readonly Pick<AnimalSim, 'entityId' | 'kind' | 'hp' | 'maxHp' | 'alive' | 'position' | 'yaw' | 'snapshot' | 'restore'>[] }

/** Transitional runtimes rebuild native geometry. Only bounded stable creature health/pose is portable;
 * authored progress and inventory keep their ordinary instance writers. No opaque Rapier handles are reassigned. */
export function regionalRuntimeCheckpoint(store: SaveStore, instance: LocalSaveInstance, revision: number): {
  restore: (animals: Creatures) => void; checkpoint: (animals: Creatures) => boolean;
} {
  const metadata = store.define(definition);
  const initialStatus = metadata.status?.(instance.id);
  if (initialStatus === 'future' || initialStatus === 'invalid') throw new Error('Runtime continuation is invalid or from a future version');
  const slot = instanceSave(store, definition, instance);
  return { restore: animals => {
    const status = metadata.status?.(slot.instanceId);
    if (status === 'future' || status === 'invalid') throw new Error('Runtime continuation is invalid or from a future version');
    const saved = slot.read();
    if (saved === null) return;
    if (saved.revision > revision) throw new Error('Runtime continuation is from a future revision');
    const byId = new Map(animals.animals.map(animal => [animal.entityId, animal]));
    // Validate every assignment first, so a refusal cannot partially damage the freshly rebuilt world.
    for (const row of saved.actors) {
      const animal = byId.get(row.id);
      if (animal === undefined) {
        if (row.alive && saved.revision === revision) throw new Error(`Missing stable runtime creature: ${row.id} (${row.kind})`);
        continue; // deleted/dead actors never manufacture a creature or regrant its rewards
      }
      if (animal.kind !== row.kind || animal.maxHp !== row.maxHp) throw new Error(`Runtime creature identity changed: ${row.id}, saved ${row.kind}/${row.maxHp}, rebuilt ${animal.kind}/${animal.maxHp}`);
    }
    for (const row of saved.actors) {
      const animal = byId.get(row.id); if (animal === undefined) continue;
      const fresh = animal.snapshot();
      animal.restore({ ...fresh, motion: { ...fresh.motion, hp: row.hp, yaw: row.yaw },
        flags: { ...fresh.flags, alive: row.alive }, position: [row.x, row.y, row.z] });
    }
  }, checkpoint: animals => {
    const value = v.parse(schema, { revision, actors: animals.animals.map(animal => ({ id: animal.entityId, kind: animal.kind,
      hp: animal.hp, maxHp: animal.maxHp, alive: animal.alive, x: animal.position.x, y: animal.position.y, z: animal.position.z, yaw: animal.yaw })) });
    if (JSON.stringify(value).length > 512 * 1024) throw new Error('Runtime logical checkpoint exceeds regional character budget');
    return slot.write(value);
  } };
}
