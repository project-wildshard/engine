export const QUICK_TESTS: string[];
export function pushGuards(changed: readonly string[]): string[];
export function forceRerunTriggers(root: string): string[];
export function capRelated(related: string[], changed: string[], durations: Map<string, number>, seconds: number, workers: number, required?: string[]):
  { run: string[]; left: string[] };
export function scriptScenarioTests(changed: string[], tests: string[]): string[];
export function productReaderTests(changed: string[], registry: Record<string, string[]>): string[];
