import {performanceReport, type PerformanceObservations} from '@wildshard/format/shardfileAssets';
import type {Shardfile} from '@wildshard/format/shardSchema';
import type {ShardfileCheckFailure, ShardfileCheckReport, ShardfileEntryProof} from '@wildshard/engine/game/shardfile/checkReport';
import {validateSimulation} from './headless';

type CheckObservations = ShardfileEntryProof & PerformanceObservations;
/** Trusted host inputs, never fields in a shard or options accepted from author data. */
export interface ShardfileCheckOptions {
  readonly sections?: ReadonlyMap<string, unknown>;
  readonly policy?: 'warn' | 'refuse';
  readonly validate?: (shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, sections?: ReadonlyMap<string, unknown>) => Promise<CheckObservations>;
}
interface Evidence {
  readonly proof: ShardfileCheckReport['proof'];
  readonly observed: PerformanceObservations;
  readonly failures: readonly ShardfileCheckFailure[];
}
const unmeasured = (): PerformanceObservations => ({scripts: {p95Micros: 0, maxMicros: 0, samples: 0}, fuel: {p95: 0, max: 0, samples: 0}});

function proofOf(row: CheckObservations): ShardfileEntryProof | 'unmeasured' {
  if (row.ticks <= 0 || row.lanes <= 0 || row.steps <= 0) return 'unmeasured';
  return {ticks: row.ticks, lanes: row.lanes, steps: row.steps,
    ...(row.liftRides === undefined ? {} : {liftRides: row.liftRides}),
    ...(row.liftCalls === undefined ? {} : {liftCalls: row.liftCalls}),
    ...(row.portalTransfers === undefined ? {} : {portalTransfers: row.portalTransfers})};
}

async function evidence(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, options: ShardfileCheckOptions): Promise<Evidence> {
  // J370: no trusted recipes are invented for a native client plan.
  if (shard.runtime !== null) return {proof: 'unmeasured', observed: unmeasured(), failures: []};
  try {
    // validateSimulation already observes and walks every entry in one resident.
    const observed = await (options.validate ?? validateSimulation)(shard, assets, options.sections);
    return {proof: proofOf(observed), observed: {scripts: observed.scripts, fuel: observed.fuel}, failures: []};
  } catch (error) {
    return {proof: 'refused', observed: unmeasured(), failures: [{code: 'check-execution', message: error instanceof Error ? error.message : String(error)}]};
  }
}

/** Full offline check: the same execution/entry proof and performance law for both callers.
 * Native execution remains explicitly unmeasured under the existing author warning policy (J370).
 * The cook calls the default policy; only trusted local checkout provenance may select warnings. */
export async function checkShardfile(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, options: ShardfileCheckOptions = {}): Promise<ShardfileCheckReport> {
  const checked = await evidence(shard, assets, options);
  const policy = options.policy ?? (shard.runtime === null ? 'refuse' : 'warn');
  const performance = performanceReport(shard, checked.observed, policy);
  const failures = [...checked.failures, ...performance.issues.filter(issue => issue.severity === 'refusal').map(issue => ({code: issue.code, message: `${issue.metric}: ${String(issue.actual)} over ${String(issue.limit)}`}))];
  return {slug: shard.identity.slug, pass: failures.length === 0, proof: checked.proof, performance, failures};
}
