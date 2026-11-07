import type { ItemRuntime } from '@wildshard/engine/combat/items';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** A tool's direct input callback already queues its toggle; plumbing supplies its keys/touch and only the other scenes. */
export function handledItemInputs(source: Shardfile): ReadonlySet<string> {
  const handled = new Set<string>();
  for (const context of source.plumbing?.input ?? []) for (const action of context.actions) {
    const item = source.items.rows.find((row) => row.kind === 'tool' && row.action === action.id);
    if (item !== undefined && source.targets.itemActions?.some((row) => row.scene === action.scene && row.item === item.id && row.action === 3)) handled.add(action.id);
  }
  return handled;
}

export function clientScene(source: Shardfile, runtimes: ReadonlyMap<string, ItemRuntime>, fallback: (id: string) => void): (id: string) => void {
  const actions = new Map((source.targets.itemActions ?? []).map((row) => [row.scene, row]));
  return (id) => {
    const action = actions.get(id); if (action === undefined) { fallback(id); return; }
    const item = runtimes.get(action.item); if (item === undefined) throw new Error('Missing admitted scene item');
    item.queue(action.action);
  };
}
