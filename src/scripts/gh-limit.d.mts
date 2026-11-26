export const RATE_LIMITED: RegExp;
export class GitHubLimitError extends Error {
  constructor(message: string, resetAt: number);
  resetAt: number;
}
export function quotaReset(gh?: (args: string[]) => {status: number | null; stdout: string}, now?: number): number;
export function ghFailure(what: string, detail: string, reset?: () => number): Error;
export function backoffMs(error: unknown, pollMs: number, now?: number): number;
export function readerPaths(env?: NodeJS.ProcessEnv): {key: string; client: string; cache: string; minter: string};
export function readerToken(options?: {env?: NodeJS.ProcessEnv; now?: number; mint?: (minter: string, env: NodeJS.ProcessEnv) => {status: number | null; stdout: string; stderr: string}}): string | undefined;
export function readerEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
