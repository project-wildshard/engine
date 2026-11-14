import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { TileDriver, tileKeys, residentTiles, followResidentTiles, tileRing, productTileRing, settleTileDrivers, settlingTiles } from './tileDriver';
import { ring, type TileContent } from './tileContent';
import { tileOrder, tileOf } from '../../../shared/game/shardfile/tileOrder';
import { noteFrameDrawn, setBuildHeld } from '@wildshard/engine/core/framePacing';
import { Group, PerspectiveCamera } from 'three';
import { StreamingCamera, type StreamingBounds } from './streamingView';

// Tile streaming T4: an entered region's per-tile content follows the player. A made-up content with something in every
// tile records each attach and each tile scope's end.
function content(failing?: number): TileContent & { attached: Map<string, Scope> } {
  const attached = new Map<string, Scope>(), all = new Set(Array.from({ length: 64 }, (_, k) => k));
  return { id: 'made-up', attached, tiles: () => all,
    attach: (tile, scope) => { if (tile === failing) return Promise.reject(new Error('broken tile')); attached.set(`r${String(tile)}`, scope); scope.onDispose(() => { attached.delete(`r${String(tile)}`); }); return Promise.resolve(); },
    attachColliders: (tile, scope) => { attached.set(`c${String(tile)}`, scope); scope.onDispose(() => { attached.delete(`c${String(tile)}`); }); return Promise.resolve(); } };
}
const settle = async (driver: TileDriver, x: number, z: number, frames: number): Promise<void> => {
  for (let i = 0; i < frames; i++) { driver.step(x, z); await Promise.resolve(); await Promise.resolve(); }
};

test('a high eye ranks visible render tiles first without moving the player or collider ring', async () => {
  const scope = new Scope('camera-tiles'), camera = new PerspectiveCamera(50, 0.5, 0.1, 1000), seen: number[] = [], colliders: number[] = [];
  camera.position.set(0, 160, 0); camera.lookAt(150, 40, -25);
  const front = 30, behind = 35, bounds = new Map<number, StreamingBounds>([
    [front, { min: [125, 0, -62.5], max: [187.5, 100, 0] }],
    [behind, { min: [-62.5, 161, 0], max: [0, 170, 62.5] }],
  ]);
  const source: TileContent = { id: 'camera-order', tiles: () => new Set([front, behind]),
    attach: key => { seen.push(key); return Promise.resolve(); } };
  const collision: TileContent = { id: 'player-collision', tiles: () => new Set(Array.from({ length: 64 }, (_, key) => key)),
    attach: () => Promise.resolve(),
    attachColliders: key => { colliders.push(key); return Promise.resolve(); } };
  const driver = new TileDriver(scope, [source, collision], () => 2, () => Promise.resolve(), bounds), view = new StreamingCamera(new Group(), () => camera);
  driver.setStreamingView(() => view.read());
  // The old horizontal deferral must not hide a visible candidate from the
  // NT8 ranking pass and let an off-view tile attach first.
  driver.setView(() => ({ x: 1, z: 0, half: Math.PI / 4 }));
  try {
    await settle(driver, 0, 0, 150);
    expect(seen).toEqual([front, behind]);
    const playerTile = tileOf(0, 0);
    expect(colliders[0]).toBe(playerTile.j * 8 + playerTile.i);
    expect(driver.resident('colliders')).toEqual(ring(tileOf(0, 0), 1));
    expect(driver.resident('render')).toEqual(ring(tileOf(0, 0), 2));
  } finally { scope.dispose(); }
});

test('the rank-0 tiles attach before controls, then the 5 x 5 fills nearest first and follows the player', async () => {
  const scope = new Scope('tiles'), made = content(), radius = { value: 2 };
  const driver = new TileDriver(scope, [made], () => radius.value, () => Promise.resolve());
  try {
    const order = tileOrder({ x: 0, z: -194 }, [{ at: [0, 0, 250], width: 8 }, { at: [250, 0, 0], width: 8 }, { at: [0, 0, -250], width: 8 }, { at: [-250, 0, 0], width: 8 }]);
    const rank0 = tileKeys(order.tiles.filter(tile => order.rank(tile) === 0));
    await driver.require(rank0);
    expect([...driver.resident('render')].sort((a, b) => a - b)).toEqual([...rank0].sort((a, b) => a - b));
    // Only visual entry owners survive within retirement slack; physical owners stay in their exact ring.
    await settle(driver, 0, -194, 80);
    const centre = tileOf(0, -194);
    for (const [layer, attachRadius] of [['render', 2], ['colliders', 1]] as const) {
      const wanted = ring(centre, attachRadius), keep = layer === 'render' ? ring(centre, attachRadius + 1) : wanted;
      expect(driver.resident(layer)).toEqual(new Set([...wanted, ...rank0.filter(key => keep.has(key))]));
    }
    // Three tiles north: fine row 0 survives at r + 1; its nearer collider ring has already left.
    await settle(driver, 10, -30, 80);
    expect(driver.resident('render').has(4)).toBe(true);
    expect(made.attached.has('r4')).toBe(true); expect(made.attached.has('c4')).toBe(false);
    await settle(driver, 10, 40, 80);
    expect(driver.resident('render').has(4)).toBe(false);
    expect(made.attached.has('r4')).toBe(false);
    const retained = driver.resident('render');
    // a radius past the whole cell (7) is refused; the current residents stay owned.
    radius.value = 8;
    expect(() => driver.step(10, 40)).toThrow('0 to 7');
    expect(driver.resident('render')).toEqual(retained);
  } finally { scope.dispose(); }
  expect(made.attached.size).toBe(0);
});

test('a tile that fails to attach stays out and is not retried', async () => {
  const scope = new Scope('tiles'), made = content(28);
  const driver = new TileDriver(scope, [made], () => 1, () => Promise.resolve());
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try {
    await settle(driver, -40, -40, 40);
    expect(driver.resident('render').has(28)).toBe(false); expect(driver.resident('render').size).toBe(8);
    expect(warned).toBe(1);
  } finally { console.warn = warn; scope.dispose(); }
});

test.each(['render', 'colliders'] as const)('a cancelled %s preparation can attach when the player returns', async layer => {
  const scope = new Scope('tiles'), made = content(), key = 28;
  let refuse = (_error: Error): void => { throw new Error('Preparation not started'); };
  let started = (): void => { throw new Error('Missing start witness'); };
  const waiting = new Promise<void>(resolve => { started = resolve; });
  let attempts = 0;
  const attach = layer === 'render' ? made.attach : made.attachColliders;
  if (attach === undefined) throw new Error('Missing fixture attachment');
  const prepare = (tile: number, owner: Scope): Promise<void> => {
    if (tile !== key || ++attempts > 1) return attach(tile, owner);
    started();
    return new Promise<void>((_resolve, reject) => { refuse = reject; });
  };
  const driver = new TileDriver(scope, [{ ...made, ...(layer === 'render' ? { attach: prepare } : { attachColliders: prepare }) }],
    () => 1, () => Promise.resolve());
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const pending = driver.require([key]);
    await waiting;
    // A sliced placer checks its tile owner after yielding and rejects when
    // movement has already retired it. That is cancellation, not bad content.
    driver.step(200, 200);
    refuse(new Error('Scene placement owner is disposed'));
    await pending;
    await settle(driver, -40, -40, 80);
    expect(driver.resident(layer).has(key)).toBe(true);
    expect(attempts).toBe(2);
    expect(made.attached.has(`${layer === 'render' ? 'r' : 'c'}${key}`)).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  } finally { warning.mockRestore(); scope.dispose(); }
});


test.each(['render', 'colliders'] as const)('a required %s failure refuses boot before later tiles', async layer => {
  const scope = new Scope('required-tiles'), made = content(), failure = new Error('required tile failed');
  const visited: number[] = [];
  const fail = (key: number): Promise<void> => { visited.push(key); return Promise.reject(failure); };
  const driver = new TileDriver(scope, [{ ...made, ...(layer === 'render' ? { attach: fail } : { attachColliders: fail }) }],
    () => 1, () => Promise.resolve());
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await expect(driver.require([28, 29])).rejects.toBe(failure);
    expect(visited).toEqual([28]);
    expect(driver.resident(layer).size).toBe(0);
  } finally { warning.mockRestore(); scope.dispose(); }
});

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => { throw new Error('Gate not initialized'); };
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('resident boot callers share pending tiles and coarse readiness before publication', async () => {
  const scope = new Scope('resident-tiles'), made = content(), started = gate(), tile = gate(), coarse = gate(), coarseStarted = gate();
  let prepares = 0;
  const source: TileContent = { ...made, attach: async (key, owner) => {
    prepares++;
    if (prepares === 1) { started.release(); await tile.promise; }
    await made.attach(key, owner);
  }, coarse: () => { coarseStarted.release(); return coarse.promise; } };
  const first = residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing);
  try {
    await started.promise;
    const second = residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing);
    let ready = false;
    void second.then(() => { ready = true; return undefined; });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).toBeNull();
    tile.release(); await coarseStarted.promise;
    expect(ready).toBe(false);
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).toBeNull();
    coarse.release(); await Promise.all([first, second]);
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).not.toBeNull();
    const count = prepares;
    await residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing);
    expect(prepares).toBe(count);
  } finally { tile.release(); coarse.release(); await Promise.allSettled([first]); scope.dispose(); }
});

test('a failed resident boot remains refused without publishing or retrying its driver', async () => {
  const scope = new Scope('failed-resident'), failure = new Error('resident tile failed');
  const attach = vi.fn(() => Promise.reject(failure)), coarse = vi.fn(() => Promise.resolve());
  const source: TileContent = { id: 'failed', tiles: () => new Set([36]), attach, coarse };
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await expect(residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing)).rejects.toBe(failure);
    await expect(residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing)).rejects.toBe(failure);
    expect(attach).toHaveBeenCalledTimes(1);
    // DL21: the cover started after the first spawn tile (an empty key of this content); it is never asked again
    expect(coarse).toHaveBeenCalledTimes(1);
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).toBeNull();
  } finally { warning.mockRestore(); scope.dispose(); }
});

test('retiring a resident during coarse preparation refuses publication', async () => {
  const scope = new Scope('retired-resident'), started = gate(), coarse = gate();
  const source: TileContent = { id: 'retired', tiles: () => new Set(), attach: () => Promise.resolve(),
    coarse: () => { started.release(); return coarse.promise; } };
  const pending = residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing);
  try {
    await started.promise; scope.dispose(); coarse.release();
    await expect(pending).rejects.toThrow('Tile resident is disposed');
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).toBeNull();
  } finally { coarse.release(); scope.dispose(); }
});

test('DL21: the coarse cover starts after the first spawn tile, beside the others, and gates publication', async () => {
  const scope = new Scope('cover-beside-spawn'), made = content(), first = gate(), firstStarted = gate(), second = gate(), secondStarted = gate();
  const coarse = gate(), events: string[] = [];
  let attaches = 0;
  const source: TileContent = { ...made, attach: async (key, owner) => {
    attaches++; events.push(`attach ${String(attaches)}`);
    if (attaches === 1) { firstStarted.release(); await first.promise; }
    if (attaches === 2) { secondStarted.release(); await second.promise; }
    await made.attach(key, owner);
  }, coarse: () => { events.push('coarse'); return coarse.promise; } };
  // spawn tiles fully in: render and colliders attached for every rank-0 tile (the content's own record)
  const colliders = (): number => [...made.attached.keys()].filter(key => key.startsWith('c')).length;
  const pending = residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing);
  let ready = false;
  void pending.then(() => { ready = true; return undefined; });
  try {
    await firstStarted.promise;
    for (let i = 0; i < 5; i++) await new Promise(resolve => { setTimeout(resolve, 0); });
    expect(events).toEqual(['attach 1']); // no cover before the first spawn tile is in
    first.release(); await secondStarted.promise;
    // the first spawn tile is in, the second still attaching: the cover is already under way
    expect(events).toEqual(['attach 1', 'coarse', 'attach 2']);
    second.release();
    for (let i = 0; i < 100 && colliders() < 9; i++) await new Promise(resolve => { setTimeout(resolve, 0); });
    expect(colliders()).toBe(9);
    expect(events.filter(event => event === 'coarse')).toHaveLength(1);
    // every spawn tile is in, but the cover is not: nothing publishes yet
    for (let i = 0; i < 5; i++) await new Promise(resolve => { setTimeout(resolve, 0); });
    expect(ready).toBe(false);
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).toBeNull();
    coarse.release(); await pending;
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).not.toBeNull();
  } finally { first.release(); second.release(); coarse.release(); await Promise.allSettled([pending]); scope.dispose(); }
});

test('DL21: a spawn tile failing beside a running cover refuses the boot only once the cover has settled', async () => {
  const scope = new Scope('cover-then-failure'), made = content(), failure = new Error('second tile failed'), coarse = gate(), coarseStarted = gate(), thrown = gate();
  let attaches = 0, rejected = false;
  const source: TileContent = { ...made, attach: async (key, owner) => {
    attaches++;
    if (attaches === 2) { await coarseStarted.promise; thrown.release(); throw failure; }
    await made.attach(key, owner);
  }, coarse: () => { coarseStarted.release(); return coarse.promise; } };
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const pending = residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing);
  void pending.catch(() => { rejected = true; });
  try {
    await thrown.promise; // the spawn failure has happened; the cover still runs
    for (let i = 0; i < 5; i++) await new Promise(resolve => { setTimeout(resolve, 0); });
    expect(rejected).toBe(false);
    coarse.release();
    await expect(pending).rejects.toBe(failure);
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).toBeNull();
  } finally { warning.mockRestore(); coarse.release(); await Promise.allSettled([pending]); scope.dispose(); }
});

test('DL21: a cover failing while spawn tiles still attach refuses the boot with its error once they are in', async () => {
  const scope = new Scope('failure-then-spawn'), made = content(), failure = new Error('cover failed'), second = gate(), secondStarted = gate();
  let attaches = 0, rejected = false, coarseCalls = 0;
  const source: TileContent = { ...made, attach: async (key, owner) => {
    attaches++;
    if (attaches === 2) { secondStarted.release(); await second.promise; }
    await made.attach(key, owner);
  }, coarse: () => { coarseCalls++; return Promise.reject(failure); } };
  const pending = residentTiles(scope, [source], { x: 0, z: 0 }, [], tileRing);
  void pending.catch(() => { rejected = true; });
  try {
    await secondStarted.promise;
    for (let i = 0; i < 5; i++) await new Promise(resolve => { setTimeout(resolve, 0); });
    // the cover has failed, a spawn tile still attaches: no refusal, no publication, no unhandled rejection yet
    expect(coarseCalls).toBe(1);
    expect(rejected).toBe(false);
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).toBeNull();
    second.release();
    await expect(pending).rejects.toBe(failure);
    expect(coarseCalls).toBe(1);
    expect(followResidentTiles(scope, () => ({ x: 0, z: 0 }))).toBeNull();
  } finally { second.release(); await Promise.allSettled([pending]); scope.dispose(); }
});

test.each(['render', 'colliders'] as const)('cached %s stages share the drawn-frame budget', async layer => {
  const owner = new Scope('paced-tile-stages'), key = 36, visited: number[] = [], turns: number[] = [];
  let now = 1000, spent = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  setBuildHeld(false); noteFrameDrawn(now, now, 30);
  const sources: TileContent[] = Array.from({ length: 24 }, (_, index) => {
    const attach = (): Promise<void> => { visited.push(index); now++; spent++; return Promise.resolve(); };
    return { id: `stage.${index}`, tiles: () => new Set([key]),
      attach: layer === 'render' ? attach : () => Promise.resolve(),
      ...(layer === 'colliders' ? { attachColliders: attach } : {}) };
  });
  const driver = new TileDriver(owner, sources, () => 1, () => {
    turns.push(spent); spent = 0; noteFrameDrawn(now, now, 30); return Promise.resolve();
  });
  try {
    await driver.require([key]);
    turns.push(spent);
    expect(visited).toEqual(Array.from({ length: 24 }, (_, index) => index));
    // A cached promise is only a microtask: all 24 used to spend one drawn frame.
    expect(Math.max(...turns)).toBeLessThanOrEqual(8);
    expect(driver.resident(layer).has(key)).toBe(true);
  } finally { owner.dispose(); noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore(); }
});

test('a background tile cancelled at its budget fence runs no later content', async () => {
  const owner = new Scope('cancel-paced-tile'), key = 36, paused = gate(), resume = gate();
  let now = 1000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  setBuildHeld(false); noteFrameDrawn(now, now, 30);
  const later = vi.fn(() => Promise.resolve());
  const driver = new TileDriver(owner, [
    { id: 'first', tiles: () => new Set([key]), attach: () => { now += 9; return Promise.resolve(); } },
    { id: 'later', tiles: () => new Set([key]), attach: later },
  ], () => 1, () => { paused.release(); return resume.promise; });
  try {
    // No collider work: step through the empty collider ring before render.
    for (let frame = 0; frame < 80; frame++) { driver.step(0, 0); await Promise.resolve(); await Promise.resolve(); }
    await paused.promise;
    driver.step(-240, -240); resume.release();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(later).not.toHaveBeenCalled();
    expect(driver.resident('render').has(key)).toBe(false);
  } finally { resume.release(); owner.dispose(); noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore(); }
});


test('loading tile stages retain their original synchronous admission', async () => {
  const owner = new Scope('loading-tile-stages'), visited: number[] = [];
  let now = 1000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  noteFrameDrawn(Number.NEGATIVE_INFINITY); setBuildHeld(false);
  const sources: TileContent[] = Array.from({ length: 24 }, (_, index) => ({
    id: `stage.${index}`, tiles: () => new Set([36]),
    attach: () => { visited.push(index); now += 10; return Promise.resolve(); },
  }));
  const pause = vi.fn(() => Promise.resolve()), driver = new TileDriver(owner, sources, () => 1, pause);
  try {
    await driver.require([36]);
    expect(visited).toEqual(Array.from({ length: 24 }, (_, index) => index));
    expect(pause).toHaveBeenCalledTimes(1); // the existing end-of-required-tile pause only
  } finally { owner.dispose(); noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore(); }
});

test('stationary priority plans still admit late content in exact collider-first distance order', async () => {
  const scope = new Scope('tile-plan-live'), events: string[] = [], all = new Set(Array.from({ length: 64 }, (_, key) => key));
  const make = (id: string): TileContent => ({ id, tiles: () => all,
    attach: key => { events.push(`${id}:r${String(key)}`); return Promise.resolve(); },
    attachColliders: key => { events.push(`${id}:c${String(key)}`); return Promise.resolve(); } });
  const contents = [make('first')], driver = new TileDriver(scope, contents, () => 1, () => Promise.resolve());
  const order = [27, 18, 19, 20, 26, 28, 34, 35, 36];
  const expected = (id: string): string[] => ['c', 'r'].flatMap(layer => order.map(key => `${id}:${layer}${String(key)}`));
  try {
    await driver.coarse(-40, -40);
    await settle(driver, -40, -40, 100);
    expect(events).toEqual(expected('first'));
    events.length = 0; contents.push(make('late'));
    await settle(driver, -30, -40, 100);
    expect(events).toEqual(expected('late'));
    expect([...driver.resident('render')].sort((a, b) => a - b)).toEqual([...order].sort((a, b) => a - b));
  } finally { scope.dispose(); }
});

test('radius changes use retirement slack and tile hysteresis while preserving owned scopes', async () => {
  const scope = new Scope('tile-plan-edges'), made = content(), radius = { value: 1 };
  const driver = new TileDriver(scope, [made], () => radius.value, () => Promise.resolve());
  try {
    await settle(driver, -40, -40, 100);
    const old = made.attached.get('r18');
    if (old === undefined) throw new Error('Missing first ring');
    radius.value = 0; driver.step(1, -40);
    expect(old.disposed).toBe(false);
    expect(driver.resident('render').has(27)).toBe(true);
    await settle(driver, 4, -40, 30);
    expect(old.disposed).toBe(true);
    expect(driver.resident('render').has(28)).toBe(true);
    radius.value = 2;
    await settle(driver, 4, -40, 160);
    expect(driver.resident('render').size).toBe(25);
    expect(driver.resident('colliders').size).toBe(9);
  } finally { scope.dispose(); }
});

test('a coarse entry keeps colliders while fine visuals wait, then refines on the same ring', async () => {
  const owner = new Scope('coarse-first'), calls: string[] = []; let controlled = false, covered = (_tile: number): boolean => false;
  const fine: TileContent = { id: 'fine', tiles: () => new Set([28]), ready: () => controlled,
    attach: (_tile, scope) => { calls.push('fine'); scope.onDispose(() => { calls.push('fine-left'); }); return Promise.resolve(); },
    attachColliders: () => { calls.push('collision'); return Promise.resolve(); } };
  const later: TileContent = { id: 'ordinary', tiles: () => new Set([28]), attach: () => { calls.push('ordinary'); return Promise.resolve(); } };
  const coarse: TileContent = { id: 'coarse', tiles: () => new Set(), attach: () => Promise.resolve(), coarse: (_scope, rendered) => { covered = rendered; return Promise.resolve(); } };
  const driver = new TileDriver(owner, [fine, later, coarse], () => 1, () => Promise.resolve());
  try {
    await driver.require([28]); await driver.coarse(0, -30); expect(calls).toEqual(['ordinary', 'collision']); expect(covered(28)).toBe(false); expect(driver.resident('render').has(28)).toBe(false);
    await settle(driver, 0, -30, 30); expect(calls).toEqual(['ordinary', 'collision']);
    controlled = true; await settle(driver, 0, -30, 30);
    expect(calls).toEqual(['ordinary', 'collision', 'fine']); expect(covered(28)).toBe(true); expect(driver.resident('render').has(28)).toBe(true);
    await settle(driver, -220, -220, 30); expect(calls).toEqual(['ordinary', 'collision', 'fine', 'fine-left']);
  } finally { owner.dispose(); }
});


test('adjacent ring crossings reuse visual owners while keeping exact collider ownership', async () => {
  const owner = new Scope('retire-slack'), made = content();
  let covered = (_key: number): boolean => false;
  const coarse: TileContent = { id: 'coarse', tiles: () => new Set(), attach: () => Promise.resolve(),
    coarse: (_scope, rendered) => { covered = rendered; return Promise.resolve(); } };
  const driver = new TileDriver(owner, [made, coarse], () => 1, () => Promise.resolve());
  try {
    await driver.coarse(-31.25, -31.25);await settle(driver, -31.25, -31.25, 100);
    const render = made.attached.get('r26'), collider = made.attached.get('c26');
    if (render === undefined || collider === undefined) throw new Error('Missing original trailing tile');
    for (let crossing = 0; crossing < 8; crossing++) {
      await settle(driver, crossing % 2 === 0 ? 31.25 : -31.25, -31.25, 100);
      expect(made.attached.get('r26')).toBe(render);expect(render.disposed).toBe(false);
      expect(collider.disposed).toBe(true);
      const colliders = driver.resident('colliders');
      expect(colliders).toEqual(ring(tileOf(crossing % 2 === 0 ? 31.25 : -31.25, -31.25), 1));
      if (crossing % 2 === 0) expect(made.attached.has('c26')).toBe(false);
      else { expect(made.attached.get('c26')).toBeDefined();expect(made.attached.get('c26')).not.toBe(collider); }
      expect(covered(26)).toBe(true); // The retained fine tile still owns the coarse cover.
    }
    await settle(driver, 93.75, -31.25, 100);
    expect(render.disposed).toBe(true);expect(collider.disposed).toBe(true);expect(covered(26)).toBe(false);
    await settle(driver, -31.25, -31.25, 100);
    expect(made.attached.get('r26')).toBeDefined();expect(made.attached.get('r26')).not.toBe(render);
    expect(made.attached.get('c26')).toBeDefined();expect(made.attached.get('c26')).not.toBe(collider);
  } finally { owner.dispose(); }
  expect(made.attached.size).toBe(0);
});

test('whole-cell radius clips its retirement slack without loading another cell', async () => {
  const owner = new Scope('whole-cell-slack'), made = content();
  const driver = new TileDriver(owner, [made], () => 7, () => Promise.resolve());
  try {
    await settle(driver, -240, -240, 400);
    expect(driver.resident('render').size).toBe(64);
    await settle(driver, 240, 240, 200);
    expect(driver.resident('render').size).toBe(64);
  } finally { owner.dispose(); }
});


test('a resident cell retains its slab owner while the player stands on the farthest tile', async () => {
  const scope = new Scope('cell-slabs'), owner = 0, attached = vi.fn<() => void>(), retired = vi.fn<() => void>();
  const source: TileContent = { id: 'cell-slab-key', tiles: () => new Set([owner]), attach: (_tile, child) => {
    attached(); child.onDispose(retired); return Promise.resolve();
  } };
  const driver = new TileDriver(scope, [source], productTileRing({ ring: 'cell' }), () => Promise.resolve());
  try {
    await driver.require([owner]);
    await settle(driver, 249, 249, 160);
    expect(driver.resident('render').has(owner)).toBe(true);
    expect(attached).toHaveBeenCalledOnce(); expect(retired).not.toHaveBeenCalled();
    await settle(driver, -249, -249, 160);
    expect(driver.resident('render').has(owner)).toBe(true);
    expect(attached).toHaveBeenCalledOnce(); expect(retired).not.toHaveBeenCalled();
  } finally { scope.dispose(); }
  expect(retired).toHaveBeenCalledOnce();
});

// DL17: the loader's fence never releases control with an in-fence tile missing
test('the loader fence resolves only once every in-fence render tile is attached', async () => {
  const scope = new Scope('tiles'), made = content();
  const driver = new TileDriver(scope, [made], () => 1, () => Promise.resolve());
  try {
    driver.step(-40, -40);
    await settleTileDrivers(undefined, 5000);
    expect(driver.resident('render').size).toBe(9);
  } finally { scope.dispose(); }
});

// DL21: under the loader the fence tiles attach together (their reads overlap); in play one at a time
// NINE-DRAGON-BENCHMAX NB3: under the loader every fence tile starts at once (a lane cap queued Nine's slab tiles behind
// the collider ring)
test('the loader settle attaches every fence tile at once', async () => {
  const scope = new Scope('tiles');
  let running = 0, most = 0;
  const releases: (() => void)[] = [];
  const slow: TileContent = { id: 'slow', tiles: () => new Set(Array.from({ length: 64 }, (_, key) => key)), attach: () => {
    running++; most = Math.max(most, running);
    return new Promise<void>(resolve => { releases.push(() => { running--; resolve(); }); });
  } };
  const driver = new TileDriver(scope, [slow], () => 1, () => Promise.resolve());
  try {
    driver.step(-40, -40);
    const settled = settleTileDrivers(undefined, 5000);
    for (let turn = 0; turn < 200 && driver.resident('render').size < 9; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); });
      releases.splice(0).forEach(release => { release(); });
    }
    await settled;
    expect(driver.resident('render').size).toBe(9);
    expect(most).toBe(9);
  } finally { scope.dispose(); }
});

test('an in-fence tile that fails is tried once more, then its error rejects the fence', async () => {
  const scope = new Scope('tiles'), made = content(28);
  const driver = new TileDriver(scope, [made], () => 1, () => Promise.resolve());
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try {
    driver.step(-40, -40);
    await expect(settleTileDrivers(undefined, 5000)).rejects.toThrow('Tile 28 failed to attach before control: broken tile');
    expect(warned).toBe(2);
  } finally { console.warn = warn; scope.dispose(); }
});

test('a fence that makes no progress rejects after its bound instead of passing incomplete', async () => {
  const scope = new Scope('tiles'), made = content();
  const hang: TileContent = { ...made, attach: (tile, owner) => (tile === 28 ? new Promise<void>(() => { /* never publishes */ }) : made.attach(tile, owner)) };
  const driver = new TileDriver(scope, [hang], () => 1, () => Promise.resolve());
  try {
    driver.step(-40, -40);
    // the hanging tile holds one of the loader's lanes for good, and its count never moves
    await expect(settleTileDrivers(undefined, 200)).rejects.toThrow(/Tile fence stalled: \d+ tiles inside it made no progress for 0 s \(first: 28/u);
  } finally { scope.dispose(); }
});

// DL21: the spawn view's card counts the settle's tiles ('tiles n of m'); outside the settle there is nothing to count
test('settlingTiles counts the fence tiles while the loader settles, and nothing outside it', async () => {
  const scope = new Scope('tiles'), made = content(), seen: { done: number; total: number }[] = [];
  // every fence tile starts at once (NB3), so each reads the count after a staggered wait: the earlier ones are done by then
  const counting: TileContent = { ...made, attach: async (tile, owner) => {
    await made.attach(tile, owner);
    await new Promise<void>(resolve => { setTimeout(resolve, tile % 9 * 2); });
    const count = settlingTiles(); if (count !== null) seen.push({ ...count });
  } };
  const driver = new TileDriver(scope, [counting], () => 1, () => Promise.resolve());
  try {
    expect(settlingTiles()).toBeNull();
    driver.step(-40, -40);
    await settleTileDrivers(undefined, 5000);
    expect(settlingTiles()).toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(count => count.total === 9 && count.done <= 9)).toBe(true);
    expect(Math.max(...seen.map(count => count.done))).toBeGreaterThan(0);
  } finally { scope.dispose(); }
});

// DL21 (Nine HEAD recording: 'tiles 0 of 64' held 2.6 s): a tile completes only at its last content stage, so the settle's
// stages count before any tile does
test('settlingTiles counts content stages before the tiles they complete', async () => {
  const scope = new Scope('tiles'), first = content(), second = content(), seen: { done: number; total: number; stages: number; stagesTotal: number }[] = [];
  // a tile's contents attach together under the loader (NB3): the second reads the count once the first has landed
  const counting: TileContent = { ...second, attach: async (tile, owner) => {
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    const count = settlingTiles(); if (count !== null) seen.push({ ...count });
    return second.attach(tile, owner);
  } };
  const driver = new TileDriver(scope, [first, counting], () => 1, () => Promise.resolve());
  try {
    driver.step(-40, -40);
    await settleTileDrivers(undefined, 5000);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(count => count.stagesTotal === count.total * 2 && count.stages <= count.stagesTotal)).toBe(true);
    // while a tile's second stage attaches, its first already counts: more stages than two per complete tile
    expect(seen.some(count => count.stages > count.done * 2)).toBe(true);
  } finally { scope.dispose(); }
});
