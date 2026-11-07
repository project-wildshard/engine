export interface WeightedRow<T, C> {
  item: T; weight: number; count?: number | readonly [number, number]; when?: (context: C) => boolean;
}
export interface TableDrop<T> { item: T; count: number }
export interface TableSpec<T, C> { mode: 'weighted' | 'each'; rows: readonly WeightedRow<T, C>[] }

/** Authoring order and the supplied random stream determine both selection and counts. */
export class WeightedTable<T, C = undefined> {
  private readonly spec: TableSpec<T, C>;
  constructor(spec: TableSpec<T, C>) { this.spec = spec; }
  pick(context: C, draw: number): WeightedRow<T, C> | null {
    const rows = this.spec.rows.filter((row) => row.when?.(context) ?? true);
    const total = rows.reduce((sum, row) => sum + Math.max(0, row.weight), 0);
    let remaining = draw * total;
    for (const row of rows) { remaining -= Math.max(0, row.weight); if (remaining <= 0) return row; }
    return rows[rows.length - 1] ?? null;
  }
  roll(context: C, next: () => number): TableDrop<T>[] {
    const selected = this.spec.mode === 'each'
      ? this.spec.rows.filter((row) => row.when?.(context) ?? true)
      : [this.pick(context, next())].filter((row) => row !== null);
    return selected.map((row) => {
      const count = row.count ?? 1;
      return { item: row.item, count: typeof count === 'number' ? count : count[0] + Math.floor(next() * (count[1] - count[0] + 1)) };
    });
  }
}
