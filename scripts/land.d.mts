import type { SpawnSyncReturns } from 'node:child_process';

export const LAND_WORKFLOWS: readonly string[];
export function localGateHatch(env: NodeJS.ProcessEnv): string | undefined;
export function smallPlanWarning(root: string, branch: string, now?: number, env?: NodeJS.ProcessEnv): string | null;
export function githubSlug(remote: string): string | null;
export function defaultMode(env: NodeJS.ProcessEnv, host: string): 'push' | 'local';
export function parseArgs(argv: string[], env?: NodeJS.ProcessEnv, host?: string): { mode: 'push' | 'local'; rounds: number; keep: boolean; done: boolean };
export function failureLine(output: string, error?: Error): string;
export const PINS_LEDGER: string;
export function shaVerdict(data: unknown, sha: string): { state: 'pending' | 'green' | 'red'; runs: Record<string, { id: number; status: string; conclusion: string | null; branch: string; url: string; attempt: number }>; summary: string };
export function mainPushArgs(sha: string): string[];
export function land(argv: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<number>;
export const STAMPS: readonly string[];
export function prePushCause(output: string, porcelain?: string): string;
export const REF_LOCK: RegExp;
export function tryGitLocked(cwd: string, args: string[], env: NodeJS.ProcessEnv, onRetry?: (why: string) => void): SpawnSyncReturns<string>;
