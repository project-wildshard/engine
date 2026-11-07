// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { app } from '../app/runtime';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import type { Game } from '../core/Game';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { Perf } from './Perf';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test('the real pill reports a freeze from its timer without another game update', () => {
  vi.useFakeTimers();
  let now = 0, gate = true, update = (): void => undefined;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const scope = new Scope('frame-pill');
  const beforeTimers = vi.getTimerCount();
  const game = legacyDouble<Game>({ app,
    level: legacyDouble<Game['level']>({ id: 'frame-pill', budgets: {} }),
    renderer: legacyDouble<Game['renderer']>({ getPixelRatio: () => 2 }),
    gl: legacyDouble<Game['gl']>({ events: 0, restoredAt: 0, lostAt: 0 }),
    frameMs: new Float32Array(120).fill(1000 / 60), frameCount: 0, frameRafTime: null, frameGate: () => gate,
    lastFrame: { calls: 1, triangles: 1 },
    onUpdate: tick => { update = () => { tick(0, 0); }; },
  });
  try {
    const meter = withOwner(scope, () => new Perf(game));
    for (let frame = 1; frame <= 60; frame++) {
      const previous = now; now = Math.round(frame * 1000 / 60);
      game.frameCount = frame; game.frameRafTime = now; update();
      vi.advanceTimersByTime(now - previous);
    }
    expect(meter.root.firstElementChild?.textContent).toBe('60');
    now = 2000; game.frameCount++; game.frameRafTime = now;
    vi.advanceTimersByTime(1000); // A resumed draw, without an update callback.
    expect(meter.root.firstElementChild?.textContent).toBe('1');
    expect(meter.root.querySelector('.ws-perf-ms')?.textContent).toBe('max 1000 ms');
    expect(meter.root.classList.contains('bad')).toBe(true);
    expect(document.querySelector('.ws-perf-live b')?.textContent).toBe('1');
    now = 4000; vi.advanceTimersByTime(2000); // No completed draws at all.
    expect(meter.root.firstElementChild?.textContent).toBe('0');
    expect(meter.root.querySelector('.ws-perf-ms')?.textContent).toBe('max 2000 ms');
    // QA8: a closed frame gate (the held loading card) is not a stall: the first frames after it read their own gaps
    gate = false; now = 12000; vi.advanceTimersByTime(8000);
    gate = true; // PLAY
    for (let frame = 1; frame <= 6; frame++) { now += 50; game.frameCount++; game.frameRafTime = now; update(); vi.advanceTimersByTime(50); }
    expect(Number(/^max (\d+) ms$/u.exec(meter.root.querySelector('.ws-perf-ms')?.textContent ?? '')?.[1])).toBeLessThan(100);
  } finally { scope.dispose(); }
  expect(vi.getTimerCount()).toBe(beforeTimers);
});


test('DL24: the meter starts at control, so the loader\'s hidden frames are no 10 s frame in the first second of play', () => {
  vi.useFakeTimers();
  let now = 0, update = (): void => undefined;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const scope = new Scope('frame-pill-control');
  const game = legacyDouble<Game>({ app,
    level: legacyDouble<Game['level']>({ id: 'frame-pill-control', budgets: {} }),
    renderer: legacyDouble<Game['renderer']>({ getPixelRatio: () => 2 }),
    gl: legacyDouble<Game['gl']>({ events: 0, restoredAt: 0, lostAt: 0 }),
    frameMs: new Float32Array(120).fill(1000 / 30), frameCount: 0, frameRafTime: null, frameGate: () => true,
    lastFrame: { calls: 1, triangles: 1 },
    onUpdate: tick => { update = () => { tick(0, 0); }; },
  });
  try {
    const meter = withOwner(scope, () => new Perf(game));
    // the loader's last hidden frame, then 10.4 s under the card with the gate open and no draw
    now = 100; game.frameCount = 1; game.frameRafTime = now; update(); vi.advanceTimersByTime(100);
    now = 10_500; vi.advanceTimersByTime(10_400);
    document.dispatchEvent(new Event('ws:control-ready'));
    for (let frame = 1; frame <= 30; frame++) { now += 33; game.frameCount++; game.frameRafTime = now; update(); vi.advanceTimersByTime(33); }
    expect(Number(/^max (\d+) ms$/u.exec(meter.root.querySelector('.ws-perf-ms')?.textContent ?? '')?.[1])).toBeLessThan(100);
  } finally { scope.dispose(); }
});

function panelGame(): Game {
  return legacyDouble<Game>({ app,
    level: legacyDouble<Game['level']>({id:'lazy-panel',budgets:{}}),
    renderer: legacyDouble<Game['renderer']>({getPixelRatio:()=>2,info:legacyDouble<Game['renderer']['info']>({memory:{textures:0,geometries:0},programs:[]})}),
    frameCount:0,frameRafTime:null,frameGate:()=>true,lastFrame:{calls:2,triangles:3},onUpdate:()=>undefined,
  });
}

test('performance details load on open, retain early counts, and retire with the original owner',async()=>{
  const scope=new Scope('lazy-perf-panel'), meter=withOwner(scope,()=>new Perf(panelGame()));
  const counts=vi.fn(()=>({animals:7}));
  try{
    meter.addCounts(counts);
    expect(Reflect.has(window,'__perfHud')).toBe(false);expect(Reflect.has(window,'__perfLapRun')).toBe(false);expect(counts).not.toHaveBeenCalled();
    meter.root.hidden=false;meter.root.dispatchEvent(new Event('pointerup'));
    await vi.waitFor(()=>{expect(Reflect.has(window,'__perfHud')).toBe(true);});
    const {PerfHud}=await import('./perfHud');
    const {PerfLap}=await import('./perfLap');
    const lap:unknown=Reflect.get(window,'__perfLapRun');
    if(!(lap instanceof PerfLap))throw new Error('Real performance lap did not load');
    const hud:unknown=Reflect.get(window,'__perfHud');
    if(!(hud instanceof PerfHud))throw new Error('Real performance details did not load');
    expect(hud.counts()).toMatchObject({animals:7,calls:2,tris:3});
    meter.addCounts(()=>({near:4}));expect(hud.counts()).toMatchObject({animals:7,near:4});
    expect(hud.scope.disposed).toBe(false);
    scope.dispose();expect(hud.scope.disposed).toBe(true);expect(lap.scope.disposed).toBe(true);
    expect(Reflect.has(window,'__perfHud')).toBe(false);
  }finally{scope.dispose();}
});

test('retirement during the real import prevents late performance controls from mounting',async()=>{
  const scope=new Scope('late-perf-panel'), meter=withOwner(scope,()=>new Perf(panelGame()));
  meter.root.hidden=false;meter.root.dispatchEvent(new Event('pointerup'));scope.dispose();
  await vi.dynamicImportSettled();
  expect(Reflect.has(window,'__perfHud')).toBe(false);
  expect(document.querySelector('.ws-perf-panel')).toBeNull();
});
