import type { BudgetLedger } from './memoryBudget.ts';

export interface PhoneMemoryRange { readonly low: number; readonly central: number; readonly high: number }
export interface PhoneMemoryChain {
  readonly gpuFloorMB: number;
  readonly alpha: Readonly<{ low: number; high: number }>;
  readonly scale: Readonly<{ low: number; high: number }>;
}
export interface PhoneLedgerModel extends PhoneMemoryChain {
  readonly ledger: Readonly<{
    webcontent: Readonly<{ floorMB: number; perMB: number }>;
    gpu: Readonly<{ floorMB: number; perMB: number }>;
    missPct: number;
  }>;
  readonly peakOverSettled: PhoneMemoryRange;
}

/** EM11. The anchor bounds the two strategies for converting Mac process
 * footprints to a phone footprint. The central figure uses the shared-GPU fit. */
export function phoneFromWebKit(k: Readonly<{ webcontent: number; gpu: number }>, model: PhoneMemoryChain): PhoneMemoryRange {
  const gpu = Math.max(0, k.gpu - model.gpuFloorMB * 1e6), { alpha, scale } = model;
  return {
    low: Math.min(k.webcontent + alpha.low * gpu, scale.low * (k.webcontent + gpu)),
    central: k.webcontent + (alpha.low + alpha.high) / 2 * gpu,
    high: Math.max(k.webcontent + alpha.high * gpu, scale.high * (k.webcontent + gpu)),
  };
}

export function ledgerSplit(counters: BudgetLedger | null | undefined): { ram: number; gpu: number } {
  const sum = (kinds: Readonly<Record<string, number>> | undefined): number => Object.values(kinds ?? {}).reduce((a, b) => a + b, 0);
  return { ram: sum(counters?.ram) + sum(counters?.workers), gpu: sum(counters?.gpu) };
}

/** Fold the live ledger through EM11's domain fits. The error bar includes
 * the fit's measured miss, and the boot projection includes peak-over-settled. */
export function phoneFromLedger(counters: BudgetLedger | null | undefined, model: PhoneLedgerModel,
  phase: 'playing' | 'loading' = 'playing'): PhoneMemoryRange {
  const { ram, gpu } = ledgerSplit(counters), fit = model.ledger;
  const base = phoneFromWebKit({ webcontent: (fit.webcontent.floorMB + fit.webcontent.perMB * (ram / 1e6)) * 1e6,
    gpu: (fit.gpu.floorMB + fit.gpu.perMB * (gpu / 1e6)) * 1e6 }, model);
  const miss = fit.missPct / 100;
  const ratio = phase === 'loading' ? model.peakOverSettled : { low: 1, central: 1, high: 1 };
  return { low: base.low * (1 - miss) * ratio.low, central: base.central * ratio.central, high: base.high * (1 + miss) * ratio.high };
}
