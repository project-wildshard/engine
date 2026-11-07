import { parseEasedFields, type EasedFieldsRows } from '@wildshard/format/easedFields';

/** Exact constant-speed easing shared by weather presentation and checkpointed weather mechanics. */
export function easeField(value: number, target: number, dt: number, ease: { readonly rate: number } | { readonly seconds: number }): number {
  const rate = 'rate' in ease ? ease.rate : ease.seconds;
  if (![value, target, rate, dt].every(Number.isFinite) || rate <= 0 || dt < 0) throw new RangeError('Invalid eased field');
  const delta = target - value;
  return value + Math.sign(delta) * Math.min(Math.abs(delta), 'rate' in ease ? ease.rate * dt : dt / ease.seconds);
}
/** Numeric presentation state only. Durable flags stay with their quest; no saves or replication are added. */
export class EasedFields {
  readonly rows: EasedFieldsRows;
  private readonly values = new Map<string, number>();
  constructor(input: EasedFieldsRows) {
    this.rows = parseEasedFields(input);
    for (const row of this.rows.fields) this.values.set(row.field, row.else);
  }
  value(id: string): number {
    const value = this.values.get(id); if (value === undefined) throw new Error(`Missing eased field: ${id}`); return value;
  }
  /** Existing saves and capture checkpoints snap; ordinary play advances at the authored rate. */
  step(dt: number, flags: readonly string[], snap = false): void {
    const facts = new Set(flags);
    for (const row of this.rows.fields) {
      const target = row.steps.find(({ when }) => (when.all?.every(id => facts.has(id)) ?? true)
        && (when.any === undefined || when.any.length === 0 || when.any.some(id => facts.has(id)))
        && !(when.none?.some(id => facts.has(id)) ?? false)
        && (when.count === undefined || when.count.of.filter(id => facts.has(id)).length >= when.count.atLeast))?.value ?? row.else;
      this.values.set(row.field, snap ? target : easeField(this.value(row.field), target, dt, row.ease));
    }
  }
}
