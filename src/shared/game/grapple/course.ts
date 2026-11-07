import { Vector3 } from 'three';
import type { GrappleCourseRow } from '@wildshard/format/grapple';
import type { GrappleCourse } from './sim';

/** Native obstacle clearance driven by a course row. No shard callback controls motion. */
export function grappleCourse(row: GrappleCourseRow): GrappleCourse {
  const c = row.clearance;
  if (row.hooks.some(p => ![p.x, p.y, p.z].every(Number.isFinite)) || row.hooks.length > 2048)
    throw new Error('Invalid grapple anchors');
  if (c !== undefined && (![c.plane, c.min, c.max, c.base, c.top, c.ceiling].every(Number.isFinite)
    || c.min >= c.max || c.top <= c.base || c.ceiling <= c.top || c.owners.length === 0)) throw new Error('Invalid grapple clearance');
  return { name: row.name, hooks: row.hooks.map(p => new Vector3(p.x, p.y, p.z)),
    ...(row.mode === undefined ? {} : { mode: row.mode }), ...(c === undefined ? {} : { clearance: c }) };
}
