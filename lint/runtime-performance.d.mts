export interface RuntimePerformanceIssue { kind: string; start: number; end: number; line: number; site: string; message: string }
export interface RuntimePerformanceDebt { count: number; row: string }
export function runtimePerformanceSites(source: string, filename?: string, supplied?: object | null): RuntimePerformanceIssue[];
export function runtimePerformanceViolations(source: string, filename: string, baseline?: Readonly<Record<string, RuntimePerformanceDebt>>, supplied?: object | null): RuntimePerformanceIssue[];
/** Exact frozen bytes retain their historical debt without granting it to the live primary. */
export function frozenRuntimePerformanceViolations(source: string, filename: string, primary: string, digest: string, baseline: Readonly<Record<string, RuntimePerformanceDebt>>, supplied?: object | null): RuntimePerformanceIssue[];
