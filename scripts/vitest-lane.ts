import { parseCLI } from 'vitest/node';
import { assertHeavyLease } from './heavy-lane-lease.mjs';

/** Node 24 shares WASM import wrappers across isolates but can reclaim a dying
 * wrapper twice after worker retirement (nodejs/node#66366). Keep code alive for
 * the test fork's bounded lifetime; JS GC and all test limits remain enabled.
 * Remove after the V8 lifetime backport in nodejs/node#66376 ships in Node 24. */
export function vitestNodeExecArgv(version: string = process.versions.node): string[] {
  return version.split('.')[0] === '24' ? ['--no-wasm-code-gc'] : [];
}

/** Local tests leave cores for the other lanes and the measurement lane (BUILD-SPEED 1.1: a dozen lanes each
 * spawning 6 workers put 18 workers on 18 cores); CI retains Vitest's runner default. */
export function vitestMaxWorkers(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const { WS_VITEST_MAX_WORKERS: requested, CI: ci, GITHUB_ACTIONS: actions, WS_COMMIT_RELATED_TOKEN: commit } = env;
  if (requested === undefined) {
    if (ci || actions) return undefined;
    // CF1 is serialized by the commit lock; ordinary parallel lane runs keep two.
    return commit ? 4 : 2;
  }
  if (!/^[1-9]\d*$/u.test(requested) || !Number.isSafeInteger(Number(requested))) {
    throw new Error('WS_VITEST_MAX_WORKERS must be a positive integer');
  }
  return Number(requested);
}

/** Static compiler/native coverage work is serialized only when coverage is enabled. */
export function vitestCoverageEnabled(argv: readonly string[] = process.argv.slice(2)): boolean {
  return parseCLI(['vitest', ...argv]).options.coverage?.enabled === true;
}

/** Use Vitest's parser so flag values cannot masquerade as focused file filters. */
export function isFullVitest(argv: readonly string[]): boolean {
  if (argv[0] === 'list' || argv[0] === 'init' || argv[0] === 'complete' || argv.some(arg => /^(?:--help|-h|--version|-v|--mergeReports|--merge-reports|--listTags|--list-tags|--clearCache|--clear-cache)(?:=|$)/u.test(arg))) return false;
  const parsed = parseCLI(['vitest', ...argv]);
  if ((parsed.options.related?.length ?? 0) > 0) return false;
  if (parsed.filter.length === 0) return true;
  return parsed.filter.some(filter => {
    const base = filter.replaceAll('\\', '/').replaceAll(/[*?{}[\]]/gu, '').replace(/\.test\.[cm]?[jt]sx?$/u, '').replace(/\/+$/u, '').replace(/^\.\//u, '');
    return base === '' || base === '.' || base === 'test' || base === 'api-tests' || base === 'drafts/test';
  });
}

/** A full run must hold the machine lane before Vitest starts any worker pool. */
export function assertVitestLane(argv: readonly string[] = process.argv.slice(2)): void {
  if (isFullVitest(argv)) assertHeavyLease('full-test');
}
