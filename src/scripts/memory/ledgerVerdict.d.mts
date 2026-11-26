/** BUDGET-CAPS BC6/BC7/BC11: memory budgets judged through the budget verdict (the ledger on two totals a zone). */
import type { BudgetRow } from '../budgets/cli.mjs';
import type { BudgetBaselines, BudgetCaps } from '../budgets/files.mjs';

type Reading = Record<string, number>;
interface Budgets { caps: BudgetCaps; baselines: BudgetBaselines }
export interface LedgerRow extends BudgetRow { reads: number[]; detail?: Record<string, number> }
export const LEDGER_PHASES: readonly ['control', 'peak'];
export function ledgerKey(mode: string, zone: string, phase: string): string;
export function zoneContentKey(zone: string, pinned: Record<string, string>): string;
export function ledgerTotal(reading: Reading, phase: string): number;
export function judgeReads(budgets: Budgets, key: string, reads: readonly number[], contentKey: string, detail?: Record<string, number>): LedgerRow;
export function judgeLedger(input: { mode: string; zone: string; reads: readonly Reading[]; contentKey: string; budgets: Budgets }): LedgerRow[];
export function ledgerFailure(rows: readonly LedgerRow[]): string | null;
export function checkReads<R>(input: { first: R; remeasure: (count: number) => Promise<readonly R[]>; judge: (reads: readonly R[]) => LedgerRow[]; record?: boolean }): Promise<{ rows: LedgerRow[]; reads: R[] }>;
export function checkLedger(input: { mode: string; zone: string; first: Reading; remeasure: (count: number) => Promise<readonly Reading[]>; contentKey: string; budgets: Budgets; record?: boolean }): Promise<{ rows: LedgerRow[]; reads: Reading[] }>;
export function ledgerMeasures(rows: readonly LedgerRow[]): Record<string, { reads: number[]; contentKey: string; detail?: Record<string, number> }>;
export function reportLedger(input: { rows: readonly LedgerRow[]; mode: string; directory: string; commit?: string; summaryFile?: string; log?: (line: string) => void }): void;
