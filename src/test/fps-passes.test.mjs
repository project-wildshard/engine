import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { routeScript } from '../scripts/fps/measure.mjs';
import { observePasses, passBreakdownAllowed, requirePassBench } from '../scripts/fps/passes.mjs';

test('measures exclusive pass submit per composer frame and restores the hooks', () => {
  let t = 0;
  const shadowMap = { render: () => { t += 4; } };
  const scene = { name: 'RenderPass', render: () => {
    t += 2;
    shadowMap.render();
    shadowMap.render();
    t++;
  } };
  const compositor = { effects: [{ name: 'Bloom' }], render: () => { t += 10; } };
  const composer = { passes: [scene, compositor], render: () => {
    scene.render(); compositor.render(); t++;
  } };
  const originals = [composer.render, scene.render, compositor.render, shadowMap.render];
  const observe = runInNewContext('(' + observePasses.toString() + ')', { performance: { now: () => t } });
  const stop = observe(composer, { shadowMap });
  shadowMap.render(); // a separate draw is outside the composer
  composer.render();
  const result = stop();
  expect(result.total).toEqual({ frames: 1, p50Ms: 22, p95Ms: 22, maxMs: 22 });
  expect(result.passes.map(({ name, p50Ms }) => [name, p50Ms])).toEqual([
    ['1 RenderPass', 3], ['2 Bloom', 10], ['shadows', 8],
  ]);
  expect(result.slow[0].passes.shadows).toBe(8);
  expect([composer.render, scene.render, compositor.render, shadowMap.render]).toEqual(originals);
});

test('installs the desktop pass probe before navigation and waits for control', async () => {
  for (const passBreakdown of [false, true]) {
    let control;
    const window = { __WS_BUILD_ID__: 'build', __wildshard: { world: {
      game: { level: { id: 'platform.grid' }, renderer: {
        getContext: () => ({ getExtension: () => null }),
        getPixelRatio: () => 2,
        info: { programs: [] },
      }, phoneGraphics: false },
    } } };
    const document = { addEventListener(name, run, options) {
      expect(name).toBe('ws:control-ready');
      expect(options.once).toBe(true);
      control = run;
    } };
    const profile = { browser: 'chromium', tier: 'desktop', cpu: 2, graphics: 'high',
      width: 1496, height: 717, dpr: 2, cap: null, floor: 120 };
    runInNewContext(routeScript([], profile, [], passBreakdown), {
      document, window, innerWidth: 1496, innerHeight: 717,
    });
    expect(window.__dfRoute).toBeUndefined();
    expect(control).toBeTypeOf('function');
    control();
    expect(await window.__dfRoute).toMatchObject({ witness: { build: 'build', dpr: 2 }, legs: [] });
  }
});

test('the table admits pass diagnostics only for short cold desktop runs', () => {
  const dock = { dockOnly: true, coldOnly: true };
  expect(passBreakdownAllowed(['desktop-medium', 'desktop-native'], dock)).toBe(true);
  expect(passBreakdownAllowed(['desktop-medium'], { ...dock, dockOnly: false })).toBe(false);
  expect(passBreakdownAllowed(['desktop-medium'], { ...dock, coldOnly: false })).toBe(false);
  expect(passBreakdownAllowed(['desktop-medium', 'phone-low'], dock)).toBe(false);
  expect(() => requirePassBench(undefined)).toThrow('WS_BENCH=1');
  expect(() => requirePassBench('1')).not.toThrow();
});
