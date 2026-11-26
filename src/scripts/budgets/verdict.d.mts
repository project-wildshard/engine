/** BUDGET-CAPS BC1: one hard cap, one recorded baseline, the soft line derived as baseline plus 10%. */
export type BudgetKind = 'exact' | 'noisy' | 'floor';
export type BudgetStatus = 'ok' | 'raised' | 'regressed' | 'over-hard' | 'warning' | 'confirm';
export interface BudgetVerdict { status: BudgetStatus; value: number; line: number | null; delta: number | null; ratio: number | null }
export const SOFT_RATIO: number;
export function judgedValue(kind: BudgetKind, measure: number | readonly number[]): number;
export function missesHardLimit(kind: BudgetKind, value: number, hard: number): boolean;
export function softLine(baseline: number, floor?: number): number;
export function verdict(input: {
  measure: number | readonly number[];
  baseline: { value: number; contentKey: string } | null | undefined;
  hard: number | null | undefined;
  contentKey: string;
  declared?: boolean;
  kind: BudgetKind;
  floor?: number;
  confirm?: boolean;
}): BudgetVerdict;
