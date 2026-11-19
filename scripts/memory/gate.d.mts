export type Reading = Record<string, number>;
export interface Limits { absolute?: number; baseline?: number; previousMargin?: number }
export interface Warning {
  kind: 'margin' | 'gate-flake';
  metric: string;
  arm: 'absolute' | 'ratchet';
  bytes: number;
  limit: number;
  median?: number;
}
export function ratchetMargin(baseline: number): number;
export function medianOfThree(values: readonly number[]): number;
export function cleanRatchet(metrics: Record<string, Limits>, runs: readonly Reading[]): Reading;
export function checkMemory(options: {
  zone: string;
  metrics: Record<string, Limits>;
  first: Reading;
  remeasure: (count: number) => Promise<readonly Reading[]>;
  warn: (warning: Warning) => void;
  record?: boolean;
}): Promise<Reading>;
export function memoryWarningLine(mode: string, zone: string, row: Warning): string;
