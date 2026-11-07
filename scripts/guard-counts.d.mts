export function compareCounts(baseline: Record<string, unknown>, current: Record<string, Record<string, number>>, hard: Set<string>, paths?: string[], update?: boolean, defer?: boolean, strictIncreases?: boolean): { failures: string[]; warnings: string[] };
export function hardRules(file: string): Set<string>;
export function readLintConfig(file: string): { overrides?: { files?: string[]; rules?: Record<string, unknown> }[] };

export function beginGuardRequirement(root: string, file: string): string;
export function requiredGuardRules(root: string, file: string, paths: string[]): Set<string>;
export function completeGuardRequirement(root: string, file: string): void;
export function verifyGuardRequirement(root: string, file: string): void;
