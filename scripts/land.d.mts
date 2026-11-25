import type { SpawnSyncReturns } from 'node:child_process';

export const LAND_WORKFLOWS: readonly string[];
export function smallPlanWarning(root: string, branch: string, now?: number, env?: NodeJS.ProcessEnv): string | null;
export function githubSlug(remote: string): string | null;
export function defaultMode(env: NodeJS.ProcessEnv, host?: string): 'push';
export function parseArgs(argv: string[], env?: NodeJS.ProcessEnv, host?: string): { mode: 'push'; rounds: number; keep: boolean; done: boolean };
export function failureLine(output: string, error?: Error): string;
export const PINS_LEDGER: string;
export function shaVerdict(data: unknown, sha: string): { state: 'pending' | 'green' | 'red'; runs: Record<string, { id: number; status: string; conclusion: string | null; branch: string; url: string; attempt: number }>; summary: string };
export function mainPushArgs(sha: string): string[];
export function logDeletedBranch(env: NodeJS.ProcessEnv, canonical: string, where: 'local' | 'remote', branch: string, sha: string): void;
export function land(argv: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<number>;
export const STAMPS: readonly string[];
export function prePushCause(output: string, porcelain?: string, fallback?: string): string;
export function failingDetail(lines: string[]): string | undefined;
export const REF_LOCK: RegExp;
export function tryGitLocked(cwd: string, args: string[], env: NodeJS.ProcessEnv, onRetry?: (why: string) => void): SpawnSyncReturns<string>;
