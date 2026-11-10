export const REQUIRED_JOBS: Readonly<Record<string, readonly string[]>>;
export function exclusionScope(at: number, cwd?: string): string;
export function exactBranchProof(workflow: string, env?: NodeJS.ProcessEnv, options?: { scope?: (at: number) => string; now?: number }): Promise<{ reused: boolean; run: number | null; reason: string }>;
