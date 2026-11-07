export interface CommitJob { name: string; command: string[]; cwd?: string }
export interface CommitResult { name: string; code: number; timedOut: boolean; output: string; cancelled?: boolean }
export function runCommitJobs(root: string, jobs: CommitJob[], deadline: number, env?: Record<string, string | undefined>, signal?: AbortSignal, onResult?: (result: CommitResult) => void): Promise<CommitResult[]>;
export function commitGuards(changed: readonly string[]): string[];
export function commitCheckFailed(result: CommitResult): boolean;
