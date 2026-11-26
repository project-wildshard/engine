import type { Page } from 'playwright';
import type { PhoneModel } from './memory/phoneModel.mjs';

export const MEMORY_LINE_BYTES: number;
export const PHONE_MODEL: PhoneModel;
export const CHROMIUM_TO_PHONE: Readonly<{ darwin: number; linux: number }>;
export function chromiumToPhone(platform?: string): number;
export interface BootProcessTotals { browser: number; renderer: number; gpu: number }
export interface BootSample {
  atMs: number; step: string; dump: string | null; heapBytes: number; ledgerGpu?: number | null;
  ledger?: { ram: Record<string, number>; gpu: Record<string, number>; workers: Record<string, number> } | null;
}
export interface BootStepPeak { step: string; peakBytes: number; renderer: number; gpu: number; heapBytes: number }
export interface BootMemoryVerdict {
  peakBytes: number;
  peak: { renderer: number; gpu: number; browser: number; heapBytes: number; step: string; atMs: number };
  rendererPeak: { bytes: number; step: string; atMs: number };
  rendererThroughControl: boolean | null;
  heapPeakBytes: number; steps: BootStepPeak[]; samples: number; factor: number | null; phoneStep: string;
  phoneBytes: number; phoneLowBytes: number; phoneHighBytes: number; budgetBytes: number; pass: boolean;
}
export function processDumps(events: readonly unknown[]): Map<string, BootProcessTotals>;
export function alignProcessDumps(samples: readonly BootSample[], dumps: Map<string, BootProcessTotals>): Map<string, BootProcessTotals>;
export const TRACE_BUFFER_KB: number;
export function bootMemoryVerdict(samples: readonly BootSample[], dumps: Map<string, BootProcessTotals>, options?: { factor?: number; budgetBytes?: number }): BootMemoryVerdict;
export function bootMemoryLine(slug: string, verdict: BootMemoryVerdict): string;
export function bootPageURL(url: string): string;
export function bootPage(page: Page, url: string, chunk: string): Promise<void>;
export function installBootMemoryProbe(everyMs: number): void;
export function measureBootMemory(options: { url: string; chunk: string; everyMs?: number; settleMs?: number; timeoutMs?: number; entry?: 'url' | 'select' }): Promise<{
  chunk: string; url: string; entry: 'url' | 'select'; protocol: 'chromium-phone-boot/1'; ready: boolean; failure: string | null; errors: string[];
  everyMs: number; settleMs: number; elapsedMs: number; samples: BootSample[]; dumps: Map<string, BootProcessTotals>;
}>;
