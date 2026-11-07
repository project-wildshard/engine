import type { RecordValue } from './value.mjs';
import type { Page } from 'playwright';

export interface BudgetCheck { field: string; observed: number; limit: number; pass: boolean }
export function budgetChecks(current: RecordValue): BudgetCheck[];
export function budgetLines(report: RecordValue): string[];
export function budgetViews(page: Page, current?: boolean): Promise<Record<string, { draws: number; tris: number; programs: number; gpuMB: number }>>;
