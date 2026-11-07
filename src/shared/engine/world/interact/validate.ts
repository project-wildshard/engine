/**
 * validateTable — the checks a chunk's interactables table must pass before it is loaded (the "MEGA validated format"
 * of sources/wildshard/FUNDAMENTALS.md: config the server can load, never code). Pure: no three, no DOM.
 *
 *   const errors = validateTable(table, { items: Object.keys(ITEMS) });   // [] when the table is sound
 *
 * Rules: ids unique and slug-shaped; every number finite and in range (sizes > 0, a world point inside the chunk,
 * a local offset within 60 m of its POI); every lock's key is handed out by something (a key row or a chest's contents);
 * every flag a row reads is raised by some row or declared `external`; inventory items exist; hard limits on the
 * row count (griefing / perf: 256 rows, 64 per kind).
 */
import { CHUNK_HALF } from '../../core/config';
import { flagsRaised, flagsRead, type InteractDef, type InteractTable } from './types';

export const LIMITS = { rows: 256, perKind: 64, localReach: 60, doorMax: 6, plateMax: 4 };

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const finite = (...v: (number | undefined)[]) => v.every((x) => x === undefined || Number.isFinite(x));

export function validateTable(t: InteractTable, opts: { items?: readonly string[] } = {}): string[] {
  const errs: string[] = [];
  if (t.rows.length > LIMITS.rows) errs.push(`too many rows: ${t.rows.length} > ${LIMITS.rows}`);
  const perKind = new Map<string, number>();
  const ids = new Set<string>();
  const raised = new Set<string>(t.external);
  for (const d of t.rows) for (const f of flagsRaised(d)) raised.add(f);

  for (const d of t.rows) {
    const where = `${d.kind} '${d.id}'`;
    if (!SLUG.test(d.id)) errs.push(`${where}: id must be a lowercase slug`);
    if (ids.has(d.id)) errs.push(`${where}: duplicate id`);
    ids.add(d.id);
    perKind.set(d.kind, (perKind.get(d.kind) ?? 0) + 1);
    const a = d.at;
    if (!finite(a.x, a.z, a.y, a.dy, a.yaw)) errs.push(`${where}: non-finite placement`);
    if (d.reach !== undefined && !(d.reach >= 0.8 && d.reach <= 6)) errs.push(`${where}: reach out of range`);
    if (a.poi === 'world') { if (Math.abs(a.x) > CHUNK_HALF || Math.abs(a.z) > CHUNK_HALF) errs.push(`${where}: outside the chunk`); }
    else if (Math.hypot(a.x, a.z) > LIMITS.localReach) errs.push(`${where}: ${Math.round(Math.hypot(a.x, a.z))} m from its POI (max ${LIMITS.localReach})`);
    for (const f of flagsRead(d)) if (!raised.has(f)) errs.push(`${where}: reads flag '${f}' that nothing raises (declare it in external?)`);
    errs.push(...rowChecks(d, where, opts.items));
  }
  for (const [k, n] of perKind) if (n > LIMITS.perKind) errs.push(`too many ${k} rows: ${n} > ${LIMITS.perKind}`);
  for (const f of t.external) if (!/^[a-z]+:[a-z0-9-]+$/.test(f)) errs.push(`external flag '${f}' must look like 'kind:name'`);
  return errs;
}

function rowChecks(d: InteractDef, where: string, items: readonly string[] | undefined): string[] {
  const e: string[] = [];
  switch (d.kind) {
    case 'door':
      if (!(d.w > 0 && d.w <= LIMITS.doorMax && d.h > 0 && d.h <= LIMITS.doorMax)) e.push(`${where}: size out of range`);
      if (d.lock === undefined && d.opensWhen === undefined && d.requires === undefined && d.look !== 'plank') e.push(`${where}: a ${d.look} with no lock / opensWhen can never open`);
      break;
    case 'plate': if (!(d.size > 0.3 && d.size <= LIMITS.plateMax)) e.push(`${where}: size out of range`); break;
    case 'barrel': if (!(d.leash > 1 && d.leash <= 40)) e.push(`${where}: leash out of range`); break;
    case 'chest':
      if (d.contents.length === 0) e.push(`${where}: an empty chest`);
      for (const l of d.contents) if ('item' in l && items && !items.includes(l.item)) e.push(`${where}: unknown item '${l.item}'`);
      for (const l of d.contents) if ('item' in l && l.n !== undefined && !(Number.isInteger(l.n) && l.n > 0 && l.n <= 99)) e.push(`${where}: item count out of range`);
      break;
    case 'pickup': if (d.item !== undefined && items && !items.includes(d.item)) e.push(`${where}: unknown item '${d.item}'`); break;
    case 'altar': if (d.fills.length === 0 || d.fills.length > 8) e.push(`${where}: 1–8 sockets`); break;
    case 'beacon': case 'bench': case 'key': case 'lever': break;
    default: break;
  }
  return e;
}
