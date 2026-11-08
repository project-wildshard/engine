import type { BootTiming } from './timing';

/** Guaranteed boundaries of the standalone launch; optional file counts never
 * become a guessed denominator. The stage itself owns the final completion. */
const MILESTONES = ['server:shell-module', 'server:indexed-saves-open',
  'server:product-inputs', 'server:world-boot'] as const;

/** Read the current launch only. Failed operations and a previous worker cannot
 * earn credit. The same worker records already feed Copy diagnostics. */
export function serverBootProgress(timing: BootTiming, since: number): {
  readonly done: number; readonly total: number; readonly detail: string;
  readonly steps: number; readonly files: number; readonly bytes: number;
} {
  const entries = timing.entries.filter(row => row.start >= since && row.operation.startsWith('server:'));
  const completed = entries.filter(row => row.end !== null && row.result === 'complete');
  const done = MILESTONES.filter(name => completed.some(row => row.operation === name)).length;
  const files = completed.filter(row => row.operation.startsWith('server:verified-input:')).length;
  const realms = new Set(entries.filter(row => row.realm !== 'page').map(row => row.realm));
  let bytes = 0;
  for (const [key, row] of Object.entries(timing.counters)) {
    if (row.unit === 'verified-input-bytes' && row.at >= since
      && [...realms].some(realm => key.startsWith(`${realm}:`))) bytes += row.loaded;
  }
  const current = [...entries].reverse().find(row => row.end === null)?.operation.split(':')[1]?.replaceAll('-', ' ') ?? 'ready';
  return { done, total: MILESTONES.length, steps: completed.length, files, bytes,
    detail: `${completed.length} steps · ${files} verified files · ${(bytes / 1e6).toFixed(1)} MB · ${current}` };
}
