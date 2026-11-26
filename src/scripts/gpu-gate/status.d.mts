export interface Report { verdict?: string; exitCode?: number; field?: string; rows?: Report[]; fields?: Report[]; pending?: string[]; flaked?: string[] }
export interface Result { state: string; description: string }
export function shardResult(jobStatus: string, reports: Report[], markdown: string, mode: string, shard: string): Result;
export function gateResult(results: string, jobs: { name: string; conclusion: string | null; infrastructure?: boolean }[], statuses: { context: string; state: string; description: string }[]): Result;
