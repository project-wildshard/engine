/** BUDGET-CAPS BC2: budgets/caps.json and budgets/baselines.json. */
import type { BudgetKind } from './verdict.mjs';

export interface BudgetCap { hard: number | null; target?: number; unit: string; kind: BudgetKind; floor?: number; confirm?: boolean; decision: string | null; why: string }
export interface BudgetCaps { schema: number; about: string; caps: Record<string, BudgetCap> }
export interface BudgetBaseline { value: number; contentKey: string; commit?: string; declared?: string; detail?: Record<string, number> }
export interface BudgetBaselines { schema: number; about: string; baselines: Record<string, BudgetBaseline> }
export const CAPS_FILE: string;
export const BASELINES_FILE: string;
export function readCaps(root?: string): BudgetCaps;
export function readBaselines(root?: string): BudgetBaselines;
export function writeBaselines(baselines: BudgetBaselines, root?: string): void;
export function capFor(caps: Pick<BudgetCaps, 'caps'>, key: string): BudgetCap | undefined;
export function fileErrors(caps: Pick<BudgetCaps, 'caps'>, baselines: Pick<BudgetBaselines, 'baselines'>): string[];
