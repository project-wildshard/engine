import { Vector3, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { ShardTargets } from '@wildshard/format/targets';
import { syncTargetColliders } from '../../../shared/game/shardfile/targets';

/** Bind admitted targets to existing panels, physics active-state ports and the session's interaction list. */
export function installDeclaredTargets(data: ShardTargets, ports: {
  panels: ReadonlyMap<string, Object3D>; colliders: ReadonlyMap<string, { setActive: (value: boolean) => void }>;
  read: (scope: 'shared' | 'player', fieldId: number) => number; scene: (id: string) => void;
  interactables: Interactable[]; scope: Scope; system: (spec: SystemSpec) => void;
}): void {
  const bindings = data.panels.map((row) => {
    const panel = ports.panels.get(row.panel); if (panel === undefined) throw new Error('Missing admitted target panel');
    for (const id of row.colliders) if (!ports.colliders.has(id)) throw new Error('Missing admitted target collider');
    return { row, panel };
  });
  const sync = (): void => {
    for (const { row, panel } of bindings) {
      const matched = ports.read(row.scope, row.fieldId) === row.equals;
      panel.visible = matched === row.visibleWhenMatched;
    }
    // What the server opened stands open here too, or a walk through it corrects.
    syncTargetColliders(data, ports.colliders, ports.read);
  };
  sync();
  if (bindings.length > 0) ports.system({ id: 'game.shardfile.targets', phase: 'fixed.post', after: ['game.shardfile.sim'], run: sync });
  for (const row of data.interactions) {
    const interaction = { position: new Vector3(...row.at), radius: row.radius, label: row.label, wireId: row.id, onInteract: () => { ports.scene(row.scene); } };
    ports.interactables.push(interaction);
    ports.scope.onDispose(() => { const index = ports.interactables.indexOf(interaction); if (index !== -1) ports.interactables.splice(index, 1); });
  }
}
