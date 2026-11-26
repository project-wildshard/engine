import type { InputHashMemo } from './bake-input-hashes.mjs';
/** Exact producer identity; all paths are relative, hashes are SHA256 and outputs live in the supplied stage. */
export interface RecorderTask {
  id: string; inputs: Record<string, string>; command: string[]; outputs: string[];
  platform: 'portable' | 'native' | 'darwin'; tools?: Record<string, string>;
}
/** Native jobs execute on every host; Darwin-only jobs are a separate bit-exactness restriction. */
export interface RecorderOptions {
  inputHashes?: InputHashMemo; cacheDir?: string; platform?: string; arch?: string; forceCompare?: boolean;
  /** Keep an observational miss separate from producer coalescing. */probe?: boolean;
  generate: (directory: string) => Promise<void>;
}
/** A verified immutable directory with the digest of every declared generated file. */
export interface RecorderResult { directory: string; key: string; hit: boolean; hashes: Record<string, string>; elapsedMs: number; /** Hold the cache read lease through every consumer copy; release when done. Dead process leases are reaped. */release:()=>void }
/** Persistent shared cache root; WILDSHARD_GENERATE_CACHE can select another directory. */
export function recorderCacheRoot(env?: NodeJS.ProcessEnv): string;
/** Key exact input contents, command, tool versions and native host identity. */
export function recorderKey(root: string, job: RecorderTask, host?: {platform?: string; arch?: string; inputHashes?:InputHashMemo}): string;
/** Verify every output is a regular file inside its generated directory and return SHA256 digests. */
export function recorderOutputHashes(directory: string, outputs: string[]): Record<string, string>;
/** Coalesced, atomic cold generation; verified warm hits; optional fresh regenerate-and-compare. */
export function runNativeRecorder(root: string, job: RecorderTask, options: RecorderOptions): Promise<RecorderResult>;
/** Idle-age and whole-cache budgets; active readers/locks and explicit protected directories survive. */
export interface PruneOptions { maxAgeMs?: number; capBytes?: number; protect?: string[]; dryRun?: boolean }
/** What a prune deleted (or, dry, would delete) and what it kept. */
export interface PruneReport {
  deleted: { job: string; key: string; bytes: number; reason: 'age' | 'cap' }[];
  keptBytes: number; keptEntries: number; locked: number; freedBytes: number;
}
/** Prune after 24 hours idle, then cap at 4 GiB in LRU order; active readers and locks survive. */
export function pruneRecorderCache(cacheDir: string, options?: PruneOptions): PruneReport;
/** Prune at most once per 10 minutes per cache; never throws. */
export function maybePruneRecorderCache(cacheDir: string, options?: PruneOptions): PruneReport | undefined;
