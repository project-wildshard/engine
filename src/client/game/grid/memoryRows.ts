import type { MemorySnapshot } from '@wildshard/engine/core/memoryAttribution';

export type MemoryGrouping = 'owner' | 'asset';
export type MemorySort = 'total' | 'gpu' | 'ram' | 'name';
export interface MemoryRow {
  readonly owner: string; readonly asset: string;
  gpu: number; ram: number; estimated: number; allocations: number;
}
/** Scalar aggregation keeps the below-threshold subtotal: filtering never hides bytes from reconciliation. */
export function memoryRows(snapshot: MemorySnapshot, group: MemoryGrouping, sort: MemorySort,
  minimum = 1_000_000): { rows: MemoryRow[]; omitted: { gpu: number; ram: number } } {
  const groups = new Map<string, MemoryRow>();
  for (const allocation of snapshot.allocations) {
    const asset = group === 'asset' ? allocation.asset : '';
    const key = JSON.stringify([allocation.owner, asset]);
    let row = groups.get(key);
    if (row === undefined) {
      row = { owner: allocation.owner, asset, gpu: 0, ram: 0, estimated: 0, allocations: 0 }; groups.set(key, row);
    }
    row[allocation.domain] += allocation.bytes;
    row.allocations++;
    if (allocation.precision === 'estimate') row.estimated += allocation.bytes;
  }
  const omitted = { gpu: 0, ram: 0 }, rows: MemoryRow[] = [];
  for (const row of groups.values()) {
    if (row.gpu + row.ram >= minimum) rows.push(row);
    else { omitted.gpu += row.gpu; omitted.ram += row.ram; }
  }
  const name = (row: MemoryRow): string => `${row.owner}\n${row.asset}`;
  rows.sort((a, b) => (sort === 'name' ? 0 : sort === 'total' ? b.gpu + b.ram - a.gpu - a.ram : b[sort] - a[sort]) || name(a).localeCompare(name(b)));
  return { rows, omitted };
}
