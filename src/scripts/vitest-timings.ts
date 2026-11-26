import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { Reporter, TestModule, TestRunEndReason } from 'vitest/node';

/** Complete-module observations include collection/setup, not just test bodies. */
export interface ModuleTiming {
  file: string; state: string; measuredAt: number; durationMs: number; collectMs: number;
  setupMs: number; environmentMs: number; prepareMs: number;
}

/** A report artifact only: timing observations never change a test's result. */
// oxlint-disable-next-line import/no-default-export -- Vitest loads a custom reporter by its default class.
export default class ModuleTimings implements Reporter {
  private readonly startedAt = Date.now();
  private readonly output: string;
  constructor(options: { outputFile?: string } = {}) {
    const { WS_VITEST_TIMINGS: output } = process.env;
    this.output = resolve(options.outputFile ?? output ?? `tmp/vitest-timings/${process.pid}.json`);
  }
  onTestRunEnd(modules: readonly TestModule[], _errors: readonly unknown[], reason: TestRunEndReason): void {
    const measuredAt = Date.now(), { GITHUB_SHA: sha, GITHUB_RUN_ID: run } = process.env;
    const files: ModuleTiming[] = modules.map(module => {
      const timing = module.diagnostic();
      return { file: relative(process.cwd(), module.moduleId).replaceAll('\\', '/'), state: module.state(), measuredAt,
        durationMs: timing.duration, collectMs: timing.collectDuration, setupMs: timing.setupDuration,
        environmentMs: timing.environmentSetupDuration, prepareMs: timing.prepareDuration };
    });
    mkdirSync(dirname(this.output), { recursive: true });
    writeFileSync(this.output, JSON.stringify({ version: 1, sha: sha ?? null, run: run ?? null, reason,
      startedAt: this.startedAt, endedAt: measuredAt, node: process.versions.node, files }, null, 2));
  }
}
