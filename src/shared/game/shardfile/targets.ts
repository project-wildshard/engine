import type { ShardTargets } from '@wildshard/format/targets';

/** The authoritative host applies collider activation after scripts; client and headless runs share this function. */
export function syncTargetColliders(targets: ShardTargets, colliders: ReadonlyMap<string, { setActive: (active: boolean) => void }>, read: (scope: 'shared' | 'player', id: number) => number): void {
  for (const row of targets.panels) {
    const active = (read(row.scope, row.fieldId) === row.equals) === row.activeWhenMatched;
    for (const idValue of row.colliders) {
      const collider = colliders.get(idValue); if (collider === undefined) throw new Error('Missing declared target collider'); collider.setActive(active);
    }
  }
}
