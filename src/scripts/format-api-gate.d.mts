import type { BelowFloor } from './format-floor-pointers.mjs';

export const FORMAT_API: string;
export function compareRelease(left: string, right: string): number;
export function observeApiPackage(api?: string, timeoutMs?: number): Promise<string>;
export interface GateOptions {
  observe?: () => Promise<string>;
  /** Meta QA 11-25 row 143: the pin's floor and every API pointer below it. */
  floor?: (pin: string) => Promise<{ floor: string; below: BelowFloor[] }>;
  warn?: (line: string) => void;
  env?: Record<string, string | undefined>;
}
export function formatApiFailures(before: string | undefined, after: string | undefined, options?: GateOptions): Promise<string[]>;
export function refsFailures(refs: string, root: string, options?: GateOptions): Promise<string[]>;
