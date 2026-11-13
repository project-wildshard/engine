/**
 * T2E-1b (TEMPLATE-E2E): the area the test probe reports. A grid page's own level is the shell (`platform.grid`); the
 * player stands in one of its cells, whose shard, door panels and quest flags are what a smoke asserts on. A one-shard
 * page's area is its shard.
 */
import type { ProbeArea, ProbeAreaTarget } from '@wildshard/engine/debug/probe';

/** What the grid lends the probe: the cell the player is in, the catalogue cells, and per cell its panels and flags. */
export interface GridAreaPorts {
  /** the cell the page stands in; null on the road between cells */
  readonly current: string | null;
  readonly cells: readonly { readonly instance: string; readonly slug: string }[];
  readonly targets: (instance: string) => readonly ProbeAreaTarget[];
  readonly flags: (instance: string) => readonly string[];
}

/** The current grid cell as the probe's area; null on the road. */
export function gridArea(ports: GridAreaPorts): ProbeArea | null {
  const cell = ports.cells.find(row => row.instance === ports.current);
  if (cell === undefined) return null;
  return { slug: cell.slug, instance: cell.instance, targets: ports.targets(cell.instance), flags: [...new Set(ports.flags(cell.instance))].sort() };
}

/** A one-shard page's area: its shard, the targets its shardfile client exposes (debug `shardfile`), and its flags. */
export function shardArea(slug: string, exposed: unknown, flags: readonly string[]): ProbeArea {
  return { slug, instance: null, targets: exposedTargets(exposed), flags: [...new Set(flags)].sort() };
}

function isTarget(value: unknown): value is ProbeAreaTarget {
  return typeof value === 'object' && value !== null && 'panel' in value && typeof value.panel === 'string'
    && 'visible' in value && typeof value.visible === 'boolean' && 'solid' in value && typeof value.solid === 'boolean';
}

function exposedTargets(exposed: unknown): readonly ProbeAreaTarget[] {
  if (typeof exposed !== 'object' || exposed === null || !('targets' in exposed) || typeof exposed.targets !== 'function') return [];
  const rows: unknown = Reflect.apply(exposed.targets, exposed, []);
  return Array.isArray(rows) ? rows.filter(isTarget).map(row => ({ panel: row.panel, visible: row.visible, solid: row.solid })) : [];
}
