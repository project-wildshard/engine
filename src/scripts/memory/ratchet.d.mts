import type { BudgetLedger, MemorySubsystem } from '../../shared/engine/core/memoryBudget.ts';

export interface LedgerBudget { control: Record<MemorySubsystem, number>; peak: Record<MemorySubsystem, number> }
export interface FootprintBudget { settled: number; spread: number }

export function ledgerBudget(checkpoints: readonly { step: string; ledger: BudgetLedger | null }[]): LedgerBudget;
export function compareLedger(baseline: LedgerBudget, runs: readonly LedgerBudget[], zone: string): LedgerBudget;
export function ledgerOverLine(baseline: LedgerBudget, run: LedgerBudget, zone: string): string | null;
export function confirmLedger(baseline: LedgerBudget, runs: readonly LedgerBudget[], zone: string): LedgerBudget;
export function confirmZone(ports: { zone: string; baseline: LedgerBudget | undefined; boot: (round: number) => Promise<string>;
  read: (file: string) => unknown; log: (line: string) => void }): Promise<string[]>;
export function footprintBudget(readings: readonly number[]): FootprintBudget;
export function footprintInstrument(measurements: readonly unknown[], baseline: unknown): string;
export function footprintBoot(measurements: readonly unknown[], baseline: unknown): string;
export function main(argv: string[]): void;
