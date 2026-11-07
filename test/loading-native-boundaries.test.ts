// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { Loading } from '../src/client/engine/ui/Loading';
import { currentLoadingTimeline } from '../src/shared/engine/boot/timeline';
import { loadShellTemplate } from '../src/client/engine/boot/shell';
import { loadingPath } from '../src/client/game/boot/loadingPaths';

it('publishes the measured cold entry boundaries without timing-based credit', () => {
  // Preserve the official native timestamps. Completed work now owns credit;
  // elapsed time and the old calibration cannot advance an active stage.
  const origin = 28;
  const starts = [2512, 2520] as const;
  let now = origin;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('PerformanceObserver', class {
    observe(): void { /* No browser transport in this composition regression. */ }
    disconnect(): void { /* No browser transport in this composition regression. */ }
    takeRecords(): PerformanceEntry[] { return []; }
  });
  const shell = document.createElement('div');
  shell.className = 'ws-load'; shell.innerHTML = loadShellTemplate();
  shell.dataset['shell'] = ''; shell.dataset['startedAt'] = String(origin); shell.dataset['initialSetup'] = '0';
  document.body.append(shell);
  const loading = new Loading({id: 'sunscar-dunes', name: 'Sunscar'});
  try {
    loading.setPath(loadingPath('shardfile'));
    const timeline = currentLoadingTimeline();
    if (timeline === undefined) throw new Error('Missing loading timeline');
    now = starts[0];
    loading.endAdmission();
    const runtime = timeline.begin('runtimeModules');
    now = starts[1]; runtime.end();
    const data = timeline.begin('data');
    const measured = timeline.snapshot().rows.filter(row => ['runtimeModules', 'data'].includes(row.key));
    expect(measured).toHaveLength(2);
    expect(timeline.snapshot().rows.some(row=>row.key==='admission'||row.label==='Product admission')).toBe(false);
    for (const [index, row] of measured.entries()) {
      expect(row.startedAt).toBe(starts[index]);
      expect(row.setupAtStart, row.key).toBeTypeOf('number');
      if (row.setupAtStart === undefined || row.startedAt === undefined) throw new Error(`Missing boundary ${row.key}`);
      expect(row.setupAtStart, row.key).toBe(Math.floor((index + 1) / loadingPath('shardfile').steps.length * 100));
    }
    data.end();
  } finally {
    loading.scope.dispose(); document.body.replaceChildren();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});
