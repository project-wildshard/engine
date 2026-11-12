import { Vector3, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { ShardTargets } from '@wildshard/format/targets';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { syncTargetColliders } from '../../../shared/game/shardfile/targets';

type Interaction = ShardTargets['interactions'][number];
/** The family whose rack take a held copy spends (TE-ENG2's lever-action). */
const LEVER_FAMILY = 'kit.lever';

/**
 * TE-ENG6: whether a declared use target can no longer run, so its prompt (and the touch USE band) goes. Two rules, both
 * from rows: the row's `unless` names a `hooks.conditions` row that holds now (a lit brazier), or its scene takes a
 * kit.lever this player already holds (a rack after the take). Any other row is never spent, so native and older rows
 * are unchanged.
 */
export function spentUses(source: Pick<Shardfile, 'targets' | 'hooks' | 'items'>, ports: {
  read: (scope: 'shared' | 'player', fieldId: number) => number; taken: (item: string) => boolean;
}): (row: Interaction) => boolean {
  const conditions = new Map(source.hooks.conditions.map(row => [row.id, row]));
  const levers = new Set<string>(source.items.rows.flatMap(row => row.kind === 'weapon' && row.family === LEVER_FAMILY ? [row.id] : []));
  const takes = new Map((source.targets.itemActions ?? []).flatMap(row => row.action === 3 && levers.has(row.item) ? [[row.scene, row.item] as const] : []));
  for (const row of source.targets.interactions) if (row.unless !== undefined && !conditions.has(row.unless)) throw new Error(`Missing declared condition ${row.unless}`);
  return row => {
    const condition = row.unless === undefined ? undefined : conditions.get(row.unless);
    if (condition !== undefined && ports.read(condition.scope, condition.fieldId) === condition.equals) return true;
    const item = takes.get(row.scene);
    return item !== undefined && ports.taken(item);
  };
}

/** Bind admitted targets to existing panels, physics active-state ports and the session's interaction list. A `spent` use
 *  (TE-ENG6) leaves the list while it is spent and comes back when it is not. */
export function installDeclaredTargets(data: ShardTargets, ports: {
  panels: ReadonlyMap<string, Object3D>; colliders: ReadonlyMap<string, { setActive: (value: boolean) => void }>;
  read: (scope: 'shared' | 'player', fieldId: number) => number; scene: (id: string) => void;
  interactables: Interactable[]; scope: Scope; system: (spec: SystemSpec) => void;
  spent?: (row: Interaction) => boolean;
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
  const uses = data.interactions.map(row => {
    const interaction = { position: new Vector3(...row.at), radius: row.radius, label: row.label, wireId: row.id, onInteract: () => { ports.scene(row.scene); } };
    ports.interactables.push(interaction);
    ports.scope.onDispose(() => { const index = ports.interactables.indexOf(interaction); if (index !== -1) ports.interactables.splice(index, 1); });
    return { row, interaction };
  });
  const { spent } = ports;
  if (spent === undefined || uses.length === 0) return;
  const offer = (): void => {
    if (ports.scope.disposed) return;
    for (const { row, interaction } of uses) {
      const index = ports.interactables.indexOf(interaction), gone = spent(row);
      if (gone && index !== -1) ports.interactables.splice(index, 1);
      else if (!gone && index === -1) ports.interactables.push(interaction);
    }
  };
  offer();
  ports.system({ id: 'game.shardfile.spent-uses', phase: 'update', run: offer });
}
