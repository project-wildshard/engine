export const MEMORY_LINE_BYTES: number;
export const CHROMIUM_TO_PHONE: number;
export interface BootProcessTotals { browser: number; renderer: number; gpu: number }
export interface BootSample { atMs: number; step: string; dump: string | null; heapBytes: number }
export interface BootStepPeak { step: string; peakBytes: number; renderer: number; gpu: number; heapBytes: number }
export interface BootMemoryVerdict {
  peakBytes: number;
  peak: { renderer: number; gpu: number; browser: number; heapBytes: number; step: string; atMs: number };
  heapPeakBytes: number; steps: BootStepPeak[]; samples: number; factor: number; phoneBytes: number; budgetBytes: number; pass: boolean;
}
export function processDumps(events: readonly unknown[]): Map<string, BootProcessTotals>;
export function bootMemoryVerdict(samples: readonly BootSample[], dumps: Map<string, BootProcessTotals>, options?: { factor?: number; budgetBytes?: number }): BootMemoryVerdict;
export function bootMemoryLine(slug: string, verdict: BootMemoryVerdict): string;
export function bootPageURL(url: string, chunk: string): string;
export function measureBootMemory(options: { url: string; chunk: string; everyMs?: number; settleMs?: number; timeoutMs?: number }): Promise<{
  chunk: string; url: string; protocol: 'chromium-phone-boot/1'; ready: boolean; failure: string | null; errors: string[];
  everyMs: number; settleMs: number; elapsedMs: number; samples: BootSample[]; dumps: Map<string, BootProcessTotals>;
}>;
