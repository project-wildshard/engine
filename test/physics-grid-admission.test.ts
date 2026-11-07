import { afterEach, expect, test, vi } from 'vitest';
import { driveGridSeam, gridSeamRoute } from '../scripts/physics-grid.mjs';

const originalWindow = globalThis.window;
afterEach(() => { vi.useRealTimers(); vi.stubGlobal('window', originalWindow); });

test('approaches the readiness fence before owned peer admission', async () => {
  vi.useFakeTimers();
  const route = gridSeamRoute({ home: 'home', cells: [{ instance: 'home', slug: 'home', cell: [0, 0] },
    { instance: 'peer', slug: '_template', cell: [1, 0] }] }, 15);
  let x = 0, held = false, current: string | null = 'home', fenceWaits = 0, fenceFrames = 0;
  const transitions: { from: string | null; to: string | null }[] = [];
  const residents = ['home'];
  const player = { position: { x: 0, z: 0 }, velocity: { set: () => undefined }, yaw: 0, hover: false,
    hoverSpeedLimit: () => 30, setHover: (value: boolean) => { player.hover = value; },
    spawn: (at: number) => { x = at; }, motor: { collider: { isEnabled: () => true } } };
  const input = { clear: () => { held = false; }, setHeld: (_key: string, value: boolean) => { held = value; } };
  const state = () => ({ current, worldFeet: { x, y: 0.55, z: 0 }, residents, crossings: transitions.length,
    transitions, gameplayReady: true, issues: {} });
  vi.stubGlobal('window', { __wildshard: { shard: { grid: { state: () => ({ live: { live: state() } }) } },
    world: { player, game: { app: { input }, watchFrames: (frame: (dt: number) => void) => {
      const timer = setInterval(() => {
        if (held) x -= Math.sin(player.yaw) * 15 * 0.05;
        if (!residents.includes('peer') && x >= 304) { x = 304; fenceWaits++; }
        const next = x <= 250 ? 'home' : x >= 305 ? 'peer' : null;
        if (next !== current) { transitions.push({ from: current, to: next }); current = next; }
        if (current === null && x >= 304 && !residents.includes('peer')) {
          fenceFrames++; if (fenceFrames > 100) residents.push('peer');
        }
        frame(0.05);
      }, 50);
      return () => { clearInterval(timer); };
    } } } } });
  const result = driveGridSeam(route);
  await vi.advanceTimersByTimeAsync(40_000);
  expect(await result).toMatchObject({ complete: true, crossingDelta: 4, stuck: [], timedOut: false });
  expect(fenceWaits).toBeGreaterThan(0);
  expect(transitions).toEqual([{ from: 'home', to: null }, { from: null, to: 'peer' },
    { from: 'peer', to: null }, { from: null, to: 'home' }]);
});


test('diagonal peers use midpoint entries and stay on the road between cells', () => {
  const route = gridSeamRoute({ home: 'home', cells: [{ instance: 'home', slug: 'home', cell: [0, 0] },
    { instance: 'peer', slug: '_template', cell: [1, 1] }] }, 15);
  expect(route.start).toEqual({ x: 0, z: 230 });
  expect(route.waypoints).toEqual([{ x: 0, z: 277.5 }, { x: 555, z: 277.5 }, { x: 555, z: 325 },
    { x: 555, z: 277.5 }, { x: 0, z: 277.5 }, { x: 0, z: 230 }]);
  expect(route.turnaround).toBe(2);
});

test('native seam routes follow the served one-tile gap at both speeds', () => {
  const state = { pitch: 562.5, home: 'home', cells: [{ instance: 'home', slug: 'home', cell: [0, 0] as const },
    { instance: 'peer', slug: '_template', cell: [1, 1] as const }] };
  for (const speed of [15, 30] as const) {
    const route = gridSeamRoute(state, speed);
    expect(route.start).toEqual({ x: 0, z: 230 });
    expect(route.waypoints).toEqual([{ x: 0, z: 281.25 }, { x: 562.5, z: 281.25 }, { x: 562.5, z: 332.5 },
      { x: 562.5, z: 281.25 }, { x: 0, z: 281.25 }, { x: 0, z: 230 }]);
  }
  expect(() => gridSeamRoute({ ...state, pitch: Number.NaN }, 15)).toThrow('Invalid grid pitch');
});
