import type {PerformanceReport} from '@wildshard/format/shardfileAssets';

/** Counts from the existing fixed observation and complete entry traversal. */
export interface ShardfileEntryProof {
  readonly ticks: number;
  readonly lanes: number;
  readonly steps: number;
  readonly liftRides?: number;
  readonly liftCalls?: number;
  readonly portalTransfers?: number;
}
export interface ShardfileCheckFailure {readonly code: string; readonly message: string}
/** One serializable result for author check and the credential-free cook. */
export interface ShardfileCheckReport {
  readonly slug: string;
  readonly pass: boolean;
  readonly proof: ShardfileEntryProof | 'unmeasured' | 'refused';
  readonly performance: PerformanceReport;
  readonly failures: readonly ShardfileCheckFailure[];
}
