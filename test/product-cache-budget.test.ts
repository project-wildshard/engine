// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { installScopeEnvironment, scopeEnvironment } from '../src/shared/engine/app/scopeEnvironment';
import { isDev, setDev } from '../src/client/engine/core/devMode';
import { browserShardfileOptions } from '../src/client/game/shardfile/runtimeProduct';

const original = scopeEnvironment(), developer = isDev();
afterEach(() => { installScopeEnvironment(original); setDev(developer); vi.restoreAllMocks(); });
const microtasks = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('browser admission overlaps cache requests and retains its frame boundary, public or Developer', async () => {
  for (const mode of [false, true]) {
    setDev(mode);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const frames: FrameRequestCallback[] = [];
    installScopeEnvironment({ ...original, frame: render => { frames.push(render); return frames.length; } });
    const options = browserShardfileOptions('https://example.invalid/'), pause = options.pause;
    expect(options.cacheBatch).toBe(true);
    if (pause === undefined) throw new Error('Missing browser admission policy');
    let done = false; const waiting = (async () => { await pause(); done = true; })();
    await microtasks(); expect(done).toBe(false); expect(frames).toHaveLength(1);
    frames[0]?.(performance.now());
    await waiting; expect(done).toBe(true);
    vi.restoreAllMocks();
  }
});

test('cheap admission checks share a slice but spent work always paints before continuing', async () => {
  // Keep the exact 7 + 1 ms boundary representable when the clock crosses a power of two.
  let now = Math.ceil(performance.now()) + 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const frames: FrameRequestCallback[] = [];
  installScopeEnvironment({ ...original, frame: render => { frames.push(render); return frames.length; } });
  const pause = browserShardfileOptions('https://example.invalid/').pause;
  if (pause === undefined) throw new Error('Missing browser admission policy');
  try {
    let painted = false;
    const first = pause().then(() => { painted = true; return undefined; });
    await microtasks();
    expect(painted).toBe(false);
    expect(frames).toHaveLength(1);
    frames.shift()?.(now);
    await first;

    let cheapDone = false;
    const cheap = pause().then(() => { cheapDone = true; return undefined; });
    await microtasks();
    expect(cheapDone).toBe(true);
    expect(frames).toHaveLength(0);
    await cheap;
    for (let i = 0; i < 30; i++) await pause();
    expect(frames).toHaveLength(0);

    now += 7;
    await pause();
    expect(frames).toHaveLength(0);
    now += 1;
    let spentDone = false;
    const spent = pause().then(() => { spentDone = true; return undefined; });
    const joining = pause();
    await microtasks();
    expect(spentDone).toBe(false);
    expect(frames).toHaveLength(1);
    frames.shift()?.(now);
    await Promise.all([spent, joining]);
    await pause();
    expect(frames).toHaveLength(0);
  } finally {
    for (const render of frames.splice(0)) render(now);
    await microtasks();
  }
});
