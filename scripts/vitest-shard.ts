// SF74 W23 (speed audit #8): `vitest run --shard=i/n` splits by path hash, so push CI's 8 shards took 141-354 s and the
// slowest one was the run's critical path. This sequencer packs the files by their recorded durations
// (test/durations.json, written by scripts/vitest-durations.mjs from a run's results): heaviest file first onto the
// lightest shard. Every shard computes the same packing from the same file list, so each file runs exactly once. A file
// with no recorded duration counts as the median; with no durations file at all, vitest's hash split is used.
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import * as v from 'valibot';
import { prepareTestBuildTools } from './test-build-tools';
import { readDurations, packShards, readShardPlan } from './test-shard-plan';

/** Reviewed format-only suites: no host globals, mocked modules or fresh-import contracts.
 * Every other suite retains an isolated worker. Additions require the same audit. */
export const PURE_TESTS: readonly string[] = [];

// CF1 preselects exact paths without Vitest's broad related-module transform.
// Capture its existing worker token before the runner clears child inheritance.
const { WS_COMMIT_RELATED_TOKEN } = process.env;
const COMMIT_RELATED = WS_COMMIT_RELATED_TOKEN !== undefined;

/** CF3: partition before packing/collection; no cohort keeps the complete local/nightly suite. */
export function selectTestCohort(paths: readonly string[], products: Readonly<Record<string,readonly string[]>>, cohort: string | undefined): string[] {
  if (cohort === undefined) return [...paths];
  if (cohort !== 'product-free' && cohort !== 'products') throw new Error(`Unknown test cohort: ${cohort}`);
  return paths.filter(path => ((products[path]?.length ?? 0) > 0) === (cohort === 'products'));
}

export class DurationSequencer extends BaseSequencer {
  private plannedRanks: ReadonlyMap<string, number> | undefined;
  private cohort(files: TestSpecification[]): TestSpecification[] {
    const {WS_TEST_COHORT:cohort}=process.env;
    if(cohort===undefined)return files;
    const {root}=this.ctx.config;
    // A missing/malformed registry must refuse, never move every test into the free cohort.
    const products=v.parse(v.record(v.string(),v.array(v.string())),JSON.parse(readFileSync(resolve(root,'scripts/test-products.json'),'utf8')));
    const key=(spec:TestSpecification):string=>relative(root,spec.moduleId).replaceAll('\\','/');
    const selected=new Set(selectTestCohort(files.map(key),products,cohort));
    return files.filter(spec=>selected.has(key(spec)));
  }
  override async sort(candidates: TestSpecification[]): Promise<TestSpecification[]> {
    let files=this.cohort(candidates);
    const { root } = this.ctx.config;
    const registry = resolve(root, 'scripts/test-products.json');
    if (existsSync(registry)) {
      const selected = files.map(spec => relative(root, spec.moduleId).replaceAll('\\', '/'));
      const products = v.parse(v.record(v.string(), v.array(v.string())), JSON.parse(readFileSync(registry, 'utf8')));
      // Pure suites must not load the product reader's native image dependencies.
      if (selected.some(file => (products[file]?.length ?? 0) > 0)) {
        const { assertBuiltTestProducts,selectBuiltTestProducts } = await import('./built-product.mjs');
        const {CI:ci,GITHUB_ACTIONS:actions,WS_PUSH_GATE_PROFILE:pushProfile}=process.env;
        // Only local dependency walks may defer unavailable product suites.
        // Explicit file runs and CI retain the original strict preflight.
        if(((this.ctx.config.related?.length??0)>0||COMMIT_RELATED)&&!ci&&!actions&&pushProfile!=='full-v1'){
          const selection=selectBuiltTestProducts(root,selected);
          if(selection.blocked.length>0){
            console.warn(`Local related: skipping ${selection.blocked.length} product suites (CI still runs them): ${selection.blocked.join(', ')}. Missing current products: ${selection.missing.join(', ')}. Build: python3 scripts/heavy-lane.py build -- ${selection.buildCommand}`);
            if(selection.ready.length===0)throw new Error('No runnable related suites; build the named products first');
            const ready=new Set(selection.ready);
            files=files.filter(spec=>ready.has(relative(root,spec.moduleId).replaceAll('\\','/')));
          }
        } else assertBuiltTestProducts(root, selected);
      }
    }
    const started = performance.now();
    const tools = await prepareTestBuildTools(files.map(spec => relative(root, spec.moduleId).replaceAll('\\', '/')),
      JSON.parse(readFileSync(resolve(root, 'test/build-tools.json'), 'utf8')));
    if (tools.length > 0) console.info(`Test build prerequisites: ${tools.join(', ')} ready in ${Math.round(performance.now() - started)} ms (before test workers)`);
    const sorted = await super.sort(files), ranks = this.plannedRanks;
    if (ranks === undefined) return sorted;
    const rank = (spec: TestSpecification): number => {
      const value = ranks.get(relative(root, spec.moduleId).replaceAll('\\', '/'));
      if (value === undefined) throw new Error('Sorted test is absent from the checked shard plan');
      return value;
    };
    // Preserve Vitest's project/group boundaries, but dispatch each group's
    // checked LPT order. The cold default sorts by file size, leaving tiny
    // native wrapper files until the final worker tail despite their weight.
    const groups: TestSpecification[][] = [];
    for (const spec of sorted) {
      rank(spec);
      const group = groups.at(-1);
      if (group?.[0]?.project === spec.project) group.push(spec);
      else groups.push([spec]);
    }
    return groups.flatMap(group => group.sort((left, right) => rank(left) - rank(right)));
  }
  override shard(candidates: TestSpecification[]): Promise<TestSpecification[]> {
    this.plannedRanks = undefined;
    const files=this.cohort(candidates);
    const { root, shard } = this.ctx.config;
    const { WS_VITEST_PLAN: planFile, GITHUB_SHA: sha, GITHUB_RUN_ID: run } = process.env;
    if (shard !== undefined && planFile !== undefined) {
      const key = (spec: TestSpecification): string => relative(root, spec.moduleId).replaceAll('\\', '/');
      const paths = files.map(key);
      const plan = readShardPlan(JSON.parse(readFileSync(resolve(root, planFile), 'utf8')), paths, shard.count,
        sha === undefined ? undefined : { sha, ...(run === undefined ? {} : { run }) });
      const order = plan.shards[shard.index - 1]?.files ?? [];
      const mine = new Set(order);
      this.plannedRanks = new Map(order.map((file, index) => [file, index]));
      return Promise.resolve(files.filter(spec => mine.has(key(spec))));
    }
    const durations = shard === undefined ? null : readDurations(root);
    if (shard === undefined || durations === null) return super.shard(files);
    const key = (spec: TestSpecification): string => relative(root, spec.moduleId).replaceAll('\\', '/');
    const mine = new Set(packShards([...new Set(files.map(key))], durations, shard.count)[shard.index - 1]);
    return Promise.resolve(files.filter((spec) => mine.has(key(spec))));
  }
}
