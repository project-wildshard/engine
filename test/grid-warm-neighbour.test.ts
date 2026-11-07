// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real regional physics and traveller transfer.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { isDev, setDev } from '@wildshard/engine/core/devMode';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { buildYield } from '@wildshard/engine/core/workSlice';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimLevel } from '@wildshard/engine/sim';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { LiveGridHost } from '../src/client/game/grid/live';
import { PageResidency } from '../src/client/game/grid/pageResidency';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

// T7 neighbours admit inert metadata and render tiles only. Actual entry retires
// the departed whole source before allocating its destination and publishing it.
const level: SimLevel = { version: 3, id: 'platform', seed: 1, ground: { size: 500, height: 0 },
  player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 30 }, entities: [], quests: [],
  weapon: { id: 'none', shape: { kind: 'point', radius: 0 }, windup: 0, active: 0, recover: 0, cooldown: 0, range: 0, damage: 0, tags: [] } };

// a 1 m step along (dx, dz) ending at the player's position
function travel(live: LiveGridHost, at: { x: number; z: number }, dx: number, dz: number): void {
  at.x -= dx; at.z -= dz; live.beforeFixed();
  at.x += dx; at.z += dz; live.beforeFixed();
}

test.each([true, false])('T7: approach metadata never constructs a whole neighbouring world (paired=%s)', async paired => {
  const tiles: string[] = [], f = await fixture({ paired, tilePreparation: true, tileApproaches: tiles });
  try {
    await f.enterHome(); await f.approachEast();
    expect(tiles).toEqual([f.east.instance]);
    expect(f.created()).toEqual([f.home.instance]);
    expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.current()).toBe(f.home.instance);
    await f.cross(f.home.instance, f.east.instance);
    expect(f.created()).toEqual([f.home.instance, f.east.instance]);
    expect(f.live.current()).toBe(f.east.instance); expect(f.live.ready(f.east.instance)).toBe(true);
    expect(f.live.state().residents).toEqual([f.east.instance]);
  } finally { f.close(); }
});

test('T7: distance-selected metadata has no four-world admission cap', async () => {
  const f = await fixture({ allNeighbours: true, horizonSeconds: 1000 });
  try {
    await f.enterHome(); f.live.beforeFixed(); await f.settle();
    expect(new Set(f.admissions).size).toBeGreaterThan(4);
    expect(f.created()).toEqual([f.home.instance]);
    expect(f.live.state().residents).toEqual([f.home.instance]);
  } finally { f.close(); }
});

test('T7: leaving a cell retires its whole world while retaining durable metadata', async () => {
  const f = await fixture();
  try {
    await f.enterHome();
    const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.settle();
    expect(f.live.current()).toBeNull(); expect(f.live.state().residents).toEqual([]);
    expect(f.events).toContain(`retire:${f.home.instance}`);
    expect(f.claims().some(row => row.owner === f.home.instance)).toBe(false);

    const reenter = await f.live.prepare(null, f.home.instance); reenter.commit();
    expect(f.live.ready(f.home.instance)).toBe(true);
  } finally { f.close(); }
});

test('T7: a superseded actual entry retires before a different destination allocates', async () => {
  const f = await fixture();
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.holdIncoming = true;
    const first = f.live.prepare(null, f.east.instance), refused = expect(first).rejects.toThrow('Stale live frame preparation');
    await f.settle();
    const second = f.live.prepare(null, f.north.instance);
    if (f.control.finish === undefined) throw new Error('Missing actual entry completion');
    f.control.finish(); await refused;
    const prepared = await second; prepared.commit();
    expect(f.live.current()).toBe(f.north.instance);
    expect(f.allocated.find(row => row.instance === f.north.instance)?.owners).not.toContain(f.east.instance);
    expect(f.live.state().residents).toEqual([f.north.instance]);
  } finally { f.control.finish?.(); f.close(); }
});

test('T7: failed source disposal stays charged and blocks another world', async () => {
  const f = await fixture();
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.dispose = false; await f.settle();
    expect(f.live.state().retirements?.some(row => row.instance === f.home.instance && row.failed)).toBe(true);
    expect(f.claims().some(row => row.owner === f.home.instance)).toBe(true);
    await expect(f.live.prepare(null, f.east.instance)).rejects.toThrow('Exclusive runtime awaits successful disposal');
    expect(f.created()).toEqual([f.home.instance]);
  } finally { f.close(); }
});

async function fixture(options: { paired?: boolean; loading?: number; isolation?: boolean; allNeighbours?: boolean; horizonSeconds?: number;
  tilePreparation?: boolean; tileApproaches?: string[];
  tileReady?: () => Promise<void>; priorities?: string[];
  transports?: { instance: string; signal: AbortSignal }[]; transportRead?: () => Promise<void>;
  tilePins?: { instance: string; start: { readonly x: number; readonly z: number }; signal: AbortSignal }[];
  runtimeReady?: (instance: string) => Promise<void> } = {}) {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const assembly = new GridAssembly({ developer: false, devserver: false }), home = assembly.cell('driftwood-isle');
  const east = assembly.cells.find(cell => cell.origin.x === assembly.pitch && cell.origin.z === 0);
  const north = assembly.cells.find(cell => cell.origin.x === 0 && cell.origin.z === -assembly.pitch);
  if (east === undefined || north === undefined) throw new Error('Missing neighbours');
  const page = createSimHost(level, { rapier }), residency = new PageResidency(), events: string[] = [];
  const allocated: { instance: string; owners: string[] }[] = [];
  const admissions: string[] = [], runtimes: string[] = [], cancelled: string[] = [];
  const control: { dispose: boolean; holdIncoming: boolean; finish: (() => void) | undefined; reject: ((error: Error) => void) | undefined; aborted: string[]; ownedYield: boolean; yielding: boolean } = {
    dispose: true, holdIncoming: false, finish: undefined, reject: undefined, aborted: [], ownedYield: false, yielding: false,
  };
  const budget = { playing: 1_200_000_000, loading: options.loading ?? 1_800_000_000 };
  const player = { position: leadPlayer(page).position, yaw: -Math.PI / 2, health: leadPlayer(page).health, owner: leadPlayer(page), motor: leadPlayer(page).releaseMotor() };
  const live = new LiveGridHost(assembly, {
    home: { mode: 'owned', instance: home.instance, bytes: 1000, residency: residency.admitHome(home.instance, 1000) },
    player, allocator: residency.allocator,
    bindFrame: frame => { events.push(`frame:${frame.instance ?? 'road'}`); }, gameplayReady: () => true,
    ...(options.priorities === undefined ? {} : { prioritize: (cell: { instance: string }) => {
      options.priorities?.push(`hold:${cell.instance}`); return () => { options.priorities?.push(`release:${cell.instance}`); };
    } }),
    ...(options.tileApproaches === undefined && options.tilePins === undefined ? {} : { prepareNeighbour: (cell: { instance: string }, start: { readonly x: number; readonly z: number }, signal: AbortSignal) => {
      options.tileApproaches?.push(cell.instance); options.tilePins?.push({ instance: cell.instance, start, signal }); return options.tileReady?.() ?? Promise.resolve();
    } }),
    ...(options.transports === undefined ? {} : { prepareTransport: async (cell: { instance: string }, signal: AbortSignal) => {
      options.transports?.push({ instance: cell.instance, signal });
      await options.transportRead?.();
      if (!signal.aborted) await new Promise<void>(resolve => { signal.addEventListener('abort', () => { resolve(); }, { once: true }); });
    } }),
    highway: { bytes: 1000, create: () => ({ physics: page.physics, dispose: () => undefined }) },
    prefetchable: cell => options.allNeighbours === true || [home.instance, east.instance, north.instance].includes(cell.instance),
    // a large world: its readiness reach starts well inside the source
    readiness: { link: { speed: 30, linkBitsPerSecond: 5_000_000, requestLatencySeconds: 0.25, maxStallSeconds: 3 },
      bundle: () => ({ criticalWireBytes: 1000, hybridWireBytes: 1000, decodeSeconds: 0, runtimeParseSeconds: options.horizonSeconds ?? 10 }) },
    admit: cell => { admissions.push(cell.instance); return Promise.resolve({ bytes: 1000, exclusiveRuntime: true,
      prepareRuntime: () => { runtimes.push(cell.instance); return options.runtimeReady?.(cell.instance) ?? Promise.resolve(); }, cancel: () => { cancelled.push(cell.instance); },
      ...(options.tilePreparation === true ? { tilePreparation: true } : {}),
      ...(options.paired === true && options.isolation !== false ? { isolatedPreparation: true } : {}),
      create: (_claim, signal) => {
        signal?.addEventListener('abort', () => { control.aborted.push(cell.instance); }, { once: true });
        allocated.push({ instance: cell.instance, owners: [...residency.allocator.claims()].map(row => row.owner) });
        events.push(`create:${cell.instance}`);
        const host = createSimHost(level, { rapier, playerBody: false, ground: false });
        const region = { host, checkpoint: () => true, dispose: () => { events.push(`disposed:${cell.instance}`); host.dispose(); }, *retire() {
          events.push(`retire:${cell.instance}`);
          yield { scope: cell.instance, kind: 'disposers' } as const;
          if (cell.instance === home.instance && !control.dispose) throw new Error('kept disposal refused');
          host.dispose(); events.push(`disposed:${cell.instance}`);
        } };
        if (cell.instance === east.instance && control.ownedYield) return (async () => {
          const cancel = (): void => { host.scope.dispose(); };
          signal?.addEventListener('abort', cancel, { once: true });
          try { control.reject = () => { host.scope.dispose(); }; control.yielding = true; await buildYield(host.scope); return region; }
          catch (error) { region.dispose(); throw error; }
          finally { signal?.removeEventListener('abort', cancel); }
        })();
        return cell.instance === east.instance && control.holdIncoming
          ? new Promise<typeof region>((resolve, reject) => {
            control.finish = () => { resolve(region); }; control.reject = error => { region.dispose(); reject(error); };
          }) : Promise.resolve(region);
      } }); },
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) { live.beforeFixed(); await new Promise(resolve => { setTimeout(resolve, 2); }); }
  };
  const enterHome = async (): Promise<void> => { const enter = await live.prepare(null, home.instance); enter.commit(); };
  const approachEast = async (): Promise<void> => {
    // Isolation and cost come from admitted metadata, not from an unverified heading guess.
    await live.prefetch([east.instance]);
    player.position.x = CHUNK_HALF + .5; player.position.z = 0;
    travel(live, player.position, 1, 0); await settle();
  };
  const cross = async (from: string, to: string): Promise<void> => {
    const leave = await live.prepare(from, null); leave.commit();
    const enter = await live.prepare(null, to); enter.commit();
  };
  return { live, home, east, north, player, events, allocated, admissions, runtimes, cancelled, control, budget, settle, enterHome, approachEast, cross,
    claims: () => [...residency.allocator.claims()],
    entries: () => residency.allocator.entries(),
    created: () => events.filter(event => event.startsWith('create:')).map(event => event.slice(7)),
    close: () => { control.dispose = true; live.dispose(); player.motor.dispose(); page.dispose(); residency.dispose(); } };
}

test('G723: prefetch reuses a consumed admission while its constructor is pending', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.holdIncoming = true;
    const entering = f.live.prepare(null, f.east.instance); await f.settle();
    await f.live.prefetch([f.east.instance, f.east.instance, f.north.instance]);
    expect(f.admissions.filter(id => id === f.east.instance)).toHaveLength(1);
    expect(f.runtimes.filter(id => id === f.east.instance)).toHaveLength(1);
    expect(f.admissions.filter(id => id === f.north.instance)).toHaveLength(1);
    expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.state().residents).toEqual([]);
    expect(f.live.state().pending).toContain(f.east.instance);
    if (f.control.finish === undefined) throw new Error('Missing held constructor');
    f.control.finish(); const enter = await entering;
    await f.live.prefetch([f.east.instance]);
    expect(f.admissions.filter(id => id === f.east.instance)).toHaveLength(1);
    expect(f.live.ready(f.east.instance)).toBe(true);
    enter.commit();
    expect(f.live.current()).toBe(f.east.instance);
    expect(f.events.indexOf(`disposed:${f.home.instance}`)).toBeLessThan(f.events.indexOf(`frame:${f.east.instance}`));
    expect(f.live.state().issues).toEqual({});
  } finally { f.control.finish?.(); await f.settle(); f.close(); }
});

test('G723: failed construction keeps its original refusal and admits afresh only after retry', async () => {
  const f = await fixture({ paired: true }), failure = new Error('incoming constructor refused');
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.holdIncoming = true;
    const entering = f.live.prepare(null, f.east.instance), refused = expect(entering).rejects.toBe(failure);
    await f.settle();
    await f.live.prefetch([f.east.instance]);
    expect(f.admissions.filter(id => id === f.east.instance)).toHaveLength(1);
    if (f.control.reject === undefined) throw new Error('Missing held constructor');
    f.control.reject(failure); await refused;
    expect(f.live.refusal(f.east.instance)).toBe(failure);
    expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.cancelled.filter(id => id === f.east.instance)).toHaveLength(1);
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(false);
    await expect(f.live.prefetch([f.east.instance])).rejects.toThrow('incoming constructor refused');
    expect(f.admissions.filter(id => id === f.east.instance)).toHaveLength(1);
    f.live.retry(f.east.instance); f.control.holdIncoming = false;
    await f.live.prefetch([f.east.instance]);
    const enter = await f.live.prepare(null, f.east.instance); enter.commit(); await f.settle();
    expect(f.admissions.filter(id => id === f.east.instance)).toHaveLength(2);
    expect(f.live.ready(f.east.instance)).toBe(true);
    expect(f.live.state().issues).toEqual({});
  } finally { f.control.finish?.(); await f.settle(); f.close(); }
});

test('G723: a queued destination still prefetches metadata before the previous constructor settles', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.holdIncoming = true;
    const first = f.live.prepare(null, f.east.instance), obsolete = expect(first).rejects.toThrow('Stale live frame preparation');
    await f.settle();
    const entering = f.live.prepare(null, f.north.instance);
    await f.live.prefetch([f.north.instance]);
    expect(f.admissions.filter(id => id === f.north.instance)).toHaveLength(1);
    expect(f.runtimes.filter(id => id === f.north.instance)).toHaveLength(1);
    expect(f.created()).not.toContain(f.north.instance);
    expect(f.live.ready(f.north.instance)).toBe(false);
    if (f.control.finish === undefined) throw new Error('Missing held constructor');
    f.control.finish(); await obsolete;
    const enter = await entering; enter.commit();
    expect(f.live.current()).toBe(f.north.instance);
    expect(f.admissions.filter(id => id === f.north.instance)).toHaveLength(1);
    expect(f.events).toContain(`disposed:${f.east.instance}`);
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(false);
    expect(f.live.state().issues).toEqual({});
  } finally { f.control.finish?.(); await f.settle(); f.close(); }
});

test('G723: disposal still refuses prefetch while a consumed constructor settles', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.holdIncoming = true;
    const entering = f.live.prepare(null, f.east.instance), refused = expect(entering).rejects.toThrow('Live grid is disposed');
    await f.settle(); f.live.dispose();
    expect(() => f.live.prefetch([f.east.instance])).toThrow('Live grid is disposed');
    if (f.control.finish === undefined) throw new Error('Missing held constructor');
    f.control.finish(); await refused; await f.settle();
    expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(false);
  } finally { f.control.finish?.(); await f.settle(); f.close(); }
});

test.each([true, false])('G723: admission timings keep one bounded phase per cell across re-entry (Developer=%s)', async developer => {
  const previous = isDev(), f = await fixture({ paired: true });
  const names = [
    ...['admission', 'runtime'].map(phase => `wildshard.prepare:${f.east.slug}:grid.product:${f.east.instance}.${phase}`),
    ...['queue', 'metadata', 'create'].map(phase => `wildshard.prepare:${f.east.slug}:grid.prepare:${f.east.instance}.${phase}`),
  ];
  try {
    setDev(developer); await f.enterHome();
    await f.live.prefetch([f.east.instance]);
    await f.cross(f.home.instance, f.east.instance);
    await f.cross(f.east.instance, f.home.instance);
    await f.cross(f.home.instance, f.east.instance);
    expect(f.live.current()).toBe(f.east.instance); expect(f.live.state().issues).toEqual({});
    for (const name of names) {
      const spans = performance.getEntriesByName(name), span = spans[0];
      expect(spans).toHaveLength(developer ? 1 : 0);
      if (developer) {
        if (span === undefined) throw new Error('Missing grid admission phase');
        const detail: unknown = Reflect.get(span, 'detail');
        expect(detail).toEqual(expect.objectContaining({ calls: 1, failures: 0 }));
      }
    }
  } finally { setDev(previous); f.close(); for (const name of names) performance.clearMeasures(name); }
});

test('G663: in a source no neighbour builds, whichever way the traveller heads, stands or teleports', async () => {
  const f = await fixture();
  try {
    await f.enterHome();
    f.player.position.x = CHUNK_HALF - 20; travel(f.live, f.player.position, 1, 0); await f.settle();
    f.player.position.x = CHUNK_HALF - 30; f.player.position.z = -(CHUNK_HALF - 20); travel(f.live, f.player.position, 0, -1); await f.settle();
    for (let tick = 0; tick < 30; tick++) { f.player.yaw = tick * 0.01; f.live.beforeFixed(); }
    f.player.position.x = CHUNK_HALF - 5; f.player.position.z = 0; f.live.beforeFixed(); await f.settle();
    expect(f.created()).toEqual([f.home.instance]);
    expect(f.live.state().residents).toEqual([f.home.instance]);
    expect(f.live.state().issues).toEqual({});
  } finally { f.close(); }
});

test('T7: an isolated neighbour retains tiles, not a second charged world', async () => {
  const tiles: string[] = [], f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.approachEast();
    expect(tiles).toEqual([f.east.instance]);
    expect(f.live.state().residents).toEqual([]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.created()).toEqual([f.home.instance]);
    const enter = await f.live.prepare(null, f.east.instance);
    expect(f.events).toContain(`disposed:${f.home.instance}`);
    expect(f.claims().some(row => row.owner === f.home.instance)).toBe(false);
    expect(f.allocated.find(row => row.instance === f.east.instance)?.owners).not.toContain(f.home.instance);
    enter.commit();
    expect(f.events.indexOf(`disposed:${f.home.instance}`)).toBeLessThan(f.events.indexOf(`frame:${f.east.instance}`));
    expect(f.live.state().residents).toEqual([f.east.instance]);
  } finally { f.close(); }
});

test('T7: a direct heading prepares render tiles without transferring the source traveller', async () => {
  const tiles: string[] = [], f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles });
  try {
    await f.enterHome(); await f.live.prefetch([f.east.instance]);
    const sourceFrames = f.events.filter(event => event.startsWith('frame:'));
    f.player.position.x = CHUNK_HALF - 30; travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(tiles).toEqual([f.east.instance]); expect(f.live.current()).toBe(f.home.instance);
    expect(f.live.state().residents).toEqual([f.home.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.events.filter(event => event.startsWith('frame:'))).toEqual(sourceFrames);
    expect(f.events).not.toContain(`retire:${f.home.instance}`);
    expect(f.created()).toEqual([f.home.instance]);
    await f.cross(f.home.instance, f.east.instance);
    expect(f.events.indexOf(`disposed:${f.home.instance}`)).toBeLessThan(f.events.indexOf(`frame:${f.east.instance}`));
    expect(f.allocated.find(row => row.instance === f.east.instance)?.owners).not.toContain(f.home.instance);
    expect(f.live.state().residents).toEqual([f.east.instance]);
  } finally { f.close(); }
});

test('source exit starts only named transport before the readiness horizon, with no second world', async () => {
  const transports: { instance: string; signal: AbortSignal }[] = [], priorities: string[] = [];
  const f = await fixture({ transports, priorities, horizonSeconds: 0 });
  try {
    await f.enterHome(); priorities.length = 0;
    f.player.position.x = CHUNK_HALF - 30; travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(transports).toEqual([]);
    f.player.position.x = CHUNK_HALF + 0.1; travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(transports.map(row => row.instance)).toEqual([f.east.instance]);
    expect(priorities).toContain(`hold:${f.east.instance}`);
    expect(f.created()).toEqual([f.home.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.current()).toBe(f.home.instance);
    await f.cross(f.home.instance, f.east.instance); await f.settle();
    expect(transports[0]?.signal.aborted).toBe(true);
    expect(f.created()).toEqual([f.home.instance, f.east.instance]);
  } finally { f.close(); }
});

test('redirected transport drains its pending read before the next named acquisition starts', async () => {
  const transports: { instance: string; signal: AbortSignal }[] = [];
  let finish = (): void => undefined, first = true;
  const reading = new Promise<void>(resolve => { finish = resolve; });
  const f = await fixture({ transports, transportRead: () => { if (!first) return Promise.resolve(); first = false; return reading; } });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.approachEast(); expect(transports.map(row => row.instance)).toEqual([f.east.instance]);
    f.player.position.x = 0; f.player.position.z = -(CHUNK_HALF + 1); travel(f.live, f.player.position, 0, -1); await f.settle();
    expect(transports[0]?.signal.aborted).toBe(true); expect(transports).toHaveLength(1);
    finish(); await f.settle();
    expect(transports.map(row => row.instance)).toEqual([f.east.instance, f.north.instance]);
    expect(f.created()).toEqual([f.home.instance]); expect(f.live.ready(f.north.instance)).toBe(false);
  } finally { finish(); f.close(); }
});

test('stationary or teleported highway poses do not invent a transport destination', async () => {
  const transports: { instance: string; signal: AbortSignal }[] = [], f = await fixture({ transports });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.player.position.x = CHUNK_HALF + 1; f.live.beforeFixed(); await f.settle();
    expect(transports).toEqual([]);
    f.live.dispose(); await f.settle(); expect(transports).toEqual([]);
  } finally { f.close(); }
});

test('verified entry tiles prepare during runtime import without publishing a world or readiness', async () => {
  let finish = (): void => undefined;
  const runtime = new Promise<void>(resolve => { finish = resolve; });
  let blocked = '';
  const tiles: string[] = [];
  const f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles,
    runtimeReady: instance => instance === blocked ? runtime : Promise.resolve() });
  blocked = f.east.instance;
  try {
    await f.enterHome();
    const pending = f.live.prefetch([f.east.instance]);
    await f.settle();
    expect(f.runtimes).toContain(f.east.instance);
    expect(f.created()).toEqual([f.home.instance]);
    f.player.position.x = CHUNK_HALF - 30;
    travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(tiles).toEqual([f.east.instance]);
    expect(f.live.current()).toBe(f.home.instance); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.state().pending).toContain(f.east.instance);
    finish(); await pending; await f.settle();
    expect(f.created()).toEqual([f.home.instance]);
    await f.cross(f.home.instance, f.east.instance);
    expect(f.created()).toEqual([f.home.instance, f.east.instance]);
  } finally { finish(); f.close(); }
});

test('a diagonal approach retargets its one render pin when the entry tile changes', async () => {
  const pins: { instance: string; start: { readonly x: number; readonly z: number }; signal: AbortSignal }[] = [];
  const f = await fixture({ paired: true, tilePreparation: true, tilePins: pins });
  try {
    await f.enterHome(); await f.live.prefetch([f.east.instance]);
    f.player.position.x = 200; f.player.position.z = .1;
    travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(pins).toHaveLength(1); expect(pins[0]?.instance).toBe(f.east.instance);
    f.player.position.x = 212; f.player.position.z = -.1;
    travel(f.live, f.player.position, 12, -.2); await f.settle();
    expect(pins).toHaveLength(2); expect(pins[0]?.signal.aborted).toBe(true); expect(pins[1]?.signal.aborted).toBe(false);
    expect(pins[1]?.start).toEqual({ x: -250, z: -.1 });
    f.player.position.x = 224; f.player.position.z = -.2;
    travel(f.live, f.player.position, 12, -.1); await f.settle();
    expect(pins).toHaveLength(2); expect(f.created()).toEqual([f.home.instance]);
    expect(f.live.current()).toBe(f.home.instance);
  } finally { f.close(); }
});

test('G723: an active source keeps its ordinary ordering when isolation or the pair budget refuses', async () => {
  for (const options of [{ paired: true, isolation: false }, { paired: true, loading: 1 }]) {
    const f = await fixture(options);
    try {
      await f.enterHome(); await f.live.prefetch([f.east.instance]);
      f.player.position.x = CHUNK_HALF - 30; travel(f.live, f.player.position, 1, 0); await f.settle();
      expect(f.created()).toEqual([f.home.instance]);
      expect(f.live.current()).toBe(f.home.instance);
      await f.cross(f.home.instance, f.east.instance);
      expect(f.events.indexOf(`disposed:${f.home.instance}`)).toBeLessThan(f.events.indexOf(`create:${f.east.instance}`));
      expect(f.live.state().issues).toEqual({});
    } finally { f.close(); }
  }
});

test('T7: source-side tile preparation never borrows a whole-world pair budget', async () => {
  const pins: { instance: string; start: { readonly x: number; readonly z: number }; signal: AbortSignal }[] = [];
  const f = await fixture({ paired: true, tilePreparation: true, tilePins: pins });
  try {
    await f.enterHome(); await f.live.prefetch([f.east.instance]);
    f.player.position.x = CHUNK_HALF - 30; travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(pins).toHaveLength(1); expect(f.created()).toEqual([f.home.instance]);
    expect(f.live.state().issues).toEqual({}); expect(f.live.ready(f.east.instance)).toBe(false);
    const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    const back = await f.live.prepare(null, f.home.instance); back.commit(); await f.settle();
    expect(f.created().filter(id => id === f.home.instance)).toHaveLength(1);
    expect(f.live.state().residents).toEqual([f.home.instance]);
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(false);
    expect(f.events).not.toContain(`retire:${f.home.instance}`);
  } finally { f.close(); }
});

test('G723: standing inside a source never guesses its isolated neighbour', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); await f.live.prefetch([f.east.instance]);
    f.player.position.x = CHUNK_HALF - 1; await f.settle();
    expect(f.created()).toEqual([f.home.instance]);
    expect(f.live.current()).toBe(f.home.instance);
  } finally { f.close(); }
});

test('G723: committing the initial spawn does not turn its placement into a neighbour heading', async () => {
  const tiles: string[] = [], f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles });
  try {
    f.live.beforeFixed();
    const enter = await f.live.prepare(null, f.home.instance);
    f.player.position.x = CHUNK_HALF - 30; enter.commit();
    await f.live.prefetch([f.east.instance]); await f.settle();
    expect(f.live.current()).toBe(f.home.instance);
    expect(f.created()).toEqual([f.home.instance]); expect(tiles).toEqual([]);
    travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(tiles).toEqual([f.east.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.current()).toBe(f.home.instance);
  } finally { f.close(); }
});

test('G723: a source pose jump resets the heading before the next genuine movement', async () => {
  const tiles: string[] = [], f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles });
  try {
    await f.enterHome(); await f.live.prefetch([f.east.instance]); f.live.beforeFixed();
    f.player.position.x = CHUNK_HALF - 30; f.live.beforeFixed(); await f.settle();
    expect(f.created()).toEqual([f.home.instance]); expect(tiles).toEqual([]);
    travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(tiles).toEqual([f.east.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.state().residents).toEqual([f.home.instance]);
  } finally { f.close(); }
});

test('G723: a road pose jump is not a boulevard prediction and the following drive still prepares', async () => {
  const tiles: string[] = [], f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.live.prefetch([f.east.instance]);
    f.player.position.x = f.east.origin.x / 2; f.player.position.z = -300; f.live.beforeFixed();
    f.player.position.z = -100; f.live.beforeFixed(); await f.settle();
    expect(f.created()).toEqual([f.home.instance]); expect(tiles).toEqual([]);
    travel(f.live, f.player.position, 0, 1); await f.settle();
    expect(tiles).toEqual([f.east.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.state().residents).toEqual([]);
  } finally { f.close(); }
});

test('T7: actual destination-wall demand completes readiness even after a pose jump', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.live.prefetch([f.east.instance]);
    f.player.position.x = f.east.origin.x - CHUNK_HALF - .5; f.player.position.z = 0;
    f.live.beforeFixed(); await f.settle();
    expect(f.live.current()).toBeNull(); expect(f.live.ready(f.east.instance)).toBe(false);
    const prepared = await f.live.prepare(null, f.east.instance);
    expect(f.live.current()).toBeNull(); expect(f.live.ready(f.east.instance)).toBe(true);
    expect(f.live.state().residents).toEqual([f.east.instance]);
    expect(f.events).toContain(`retire:${f.home.instance}`); prepared.commit();
    expect(f.live.current()).toBe(f.east.instance);
  } finally { f.close(); }
});

test('T7: a U-turn cancels a render guess and reconstructs a departed source', async () => {
  const pins: { instance: string; start: { readonly x: number; readonly z: number }; signal: AbortSignal }[] = [];
  const f = await fixture({ paired: true, tilePreparation: true, tilePins: pins });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.approachEast(); expect(f.live.ready(f.east.instance)).toBe(false);
    const back = await f.live.prepare(null, f.home.instance); back.commit(); await f.settle();
    expect(f.created().filter(id => id === f.home.instance)).toHaveLength(2);
    expect(f.live.state().residents).toEqual([f.home.instance]);
    expect(f.events).toContain(`retire:${f.home.instance}`);
    expect(f.created()).not.toContain(f.east.instance);
  } finally { f.close(); }
  expect(pins[0]?.signal.aborted).toBe(true);
});

test('G723: a budget refusal keeps the old retire-before-allocation crossing without an issue', async () => {
  const f = await fixture({ paired: true, loading: 1 });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.approachEast();
    expect(f.created()).toEqual([f.home.instance]);
    const enter = await f.live.prepare(null, f.east.instance); enter.commit();
    expect(f.events.indexOf(`disposed:${f.home.instance}`)).toBeLessThan(f.events.indexOf(`create:${f.east.instance}`));
    expect(f.live.state().issues).toEqual({});
  } finally { f.close(); }
});

test('G723: a budget port alone never treats an opaque factory as isolated', async () => {
  const f = await fixture({ paired: true, isolation: false });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.approachEast();
    expect(f.created()).toEqual([f.home.instance]);
    const enter = await f.live.prepare(null, f.east.instance); enter.commit();
    expect(f.events.indexOf(`disposed:${f.home.instance}`)).toBeLessThan(f.events.indexOf(`create:${f.east.instance}`));
  } finally { f.close(); }
});

test('T7: queued metadata stays inert until an actual entry allocates', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.live.prefetch([f.east.instance]);
    f.player.position.x = CHUNK_HALF + .5; travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(f.created()).toEqual([f.home.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.state().issues).toEqual({});
    const enter = await f.live.prepare(null, f.east.instance); enter.commit();
    expect(f.live.ready(f.east.instance)).toBe(true);
    expect(f.created()).toEqual([f.home.instance, f.east.instance]);
    expect(f.admissions.filter(id => id === f.east.instance)).toHaveLength(1);
    expect(f.allocated.at(-1)?.owners).not.toContain(f.home.instance);
  } finally { f.close(); }
});

test('T7: a unique boulevard destination pins tiles before the traveller turns', async () => {
  const tiles: string[] = [], f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.live.prefetch([f.east.instance]);
    f.player.position.x = f.east.origin.x / 2; f.player.position.z = -100;
    travel(f.live, f.player.position, 0, 1); await f.settle();
    expect(tiles).toEqual([f.east.instance]); expect(f.live.current()).toBeNull();
    expect(f.live.ready(f.east.instance)).toBe(false); expect(f.live.state().residents).toEqual([]);
    expect(f.events).toContain(`retire:${f.home.instance}`); expect(f.created()).toEqual([f.home.instance]);
  } finally { f.close(); }
});

test('T7: replacing a prepared actual entry retires it before the next world', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    const east = await f.live.prepare(null, f.east.instance);
    expect(f.live.ready(f.east.instance)).toBe(true);
    const next = await f.live.prepare(null, f.north.instance); next.commit();
    expect(() => east.commit()).toThrow('Stale live frame commit');
    expect(f.events.indexOf(`disposed:${f.east.instance}`)).toBeLessThan(f.events.indexOf(`create:${f.north.instance}`));
    expect(f.allocated.every(row => row.owners.filter(owner => [f.home.instance, f.east.instance, f.north.instance].includes(owner)).length <= 1)).toBe(true);
    expect(f.live.state().residents).toEqual([f.north.instance]);
  } finally { f.close(); }
});

test('T7: a changed road prediction replaces only the render pin', async () => {
  const pins: { instance: string; start: { readonly x: number; readonly z: number }; signal: AbortSignal }[] = [];
  const f = await fixture({ paired: true, tilePreparation: true, tilePins: pins });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.approachEast(); await f.live.prefetch([f.north.instance]);
    f.player.position.x = 0; f.player.position.z = -(CHUNK_HALF + .5);
    travel(f.live, f.player.position, 0, -1); await f.settle();
    expect(pins.map(row => row.instance)).toEqual([f.east.instance, f.north.instance]);
    expect(pins[0]?.signal.aborted).toBe(true); expect(pins[1]?.signal.aborted).toBe(false);
    expect(f.live.state().residents).toEqual([]); expect(f.created()).toEqual([f.home.instance]);
    const next = await f.live.prepare(null, f.north.instance); next.commit();
    expect(f.allocated.at(-1)?.owners).not.toContain(f.home.instance);
    expect(f.live.state().residents).toEqual([f.north.instance]);
  } finally { f.close(); }
});

test('T7: a late actual build is disposed after a superseding U-turn, never published', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.holdIncoming = true;
    const first = f.live.prepare(null, f.east.instance), stale = expect(first).rejects.toThrow('Stale live frame preparation');
    await f.settle(); expect(f.live.state().pending).toContain(f.east.instance);
    const returning = f.live.prepare(null, f.home.instance);
    if (f.control.finish === undefined) throw new Error('Missing incoming build');
    f.control.finish(); await stale;
    const back = await returning; back.commit();
    expect(f.live.state().residents).toEqual([f.home.instance]);
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(false);
    expect(f.events).toContain(`disposed:${f.east.instance}`);
    expect(f.events).not.toContain(`frame:${f.east.instance}`);
    expect(f.live.state().issues).toEqual({});
  } finally { f.control.finish?.(); f.close(); }
});

test('T7: a sustained redirect aborts the old render owner without allocating a world', async () => {
  let finish = (): void => undefined;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const pins: { instance: string; start: { readonly x: number; readonly z: number }; signal: AbortSignal }[] = [];
  const priorities: string[] = [], f = await fixture({ paired: true, tilePreparation: true, tilePins: pins, priorities, tileReady: () => ready });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.approachEast(); await f.live.prefetch([f.north.instance]);
    f.player.position.x = 0; f.player.position.z = -(CHUNK_HALF + .5);
    travel(f.live, f.player.position, 0, -1); await f.settle();
    expect(pins[0]?.signal.aborted).toBe(true); expect(pins[1]?.signal.aborted).toBe(false);
    expect(f.control.aborted).toEqual([]); expect(f.created()).toEqual([f.home.instance]);
    expect(f.live.state().residents).toEqual([]);
    expect(priorities.filter(row => row === `release:${f.east.instance}`)).toHaveLength(0);
    finish(); await f.settle();
    expect(priorities).toContain(`release:${f.east.instance}`);
    expect(f.live.state().issues).toEqual({});
  } finally { finish(); f.close(); }
});

test('T7: an actual constructor scope cancellation releases its claim before queued entry', async () => {
  const f = await fixture({ paired: true }), failure = new Error('Requested constructor owner left');
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    await f.live.prefetch([f.east.instance]); f.control.ownedYield = true;
    const first = f.live.prepare(null, f.east.instance), refused = expect(first).rejects.toThrow();
    for (let i = 0; i < 40 && !f.control.yielding; i++) await Promise.resolve();
    expect(f.control.yielding).toBe(true); expect(f.claims().some(row => row.owner === f.east.instance)).toBe(true);
    const entering = f.live.prepare(null, f.north.instance);
    if (f.control.reject === undefined) throw new Error('Missing constructor owner cancellation');
    f.control.reject(failure); await refused;
    const enter = await entering; enter.commit();
    expect(f.live.current()).toBe(f.north.instance);
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(false);
    expect(f.events).toContain(`disposed:${f.east.instance}`);
    expect(f.live.state().pending).toEqual([]);
    expect(f.live.state().issues[f.north.instance]).toBeUndefined();
    expect(f.live.refusal(f.east.instance)).toBeInstanceOf(Error);
  } finally { f.close(); }
});

test('T7: failed source retirement blocks entry even when destination metadata is ready', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); await f.live.prefetch([f.east.instance]);
    expect(f.admissions).toContain(f.east.instance); expect(f.live.ready(f.east.instance)).toBe(false);
    const leave = await f.live.prepare(f.home.instance, null); leave.commit(); f.control.dispose = false;
    await expect(f.live.prepare(null, f.east.instance)).rejects.toThrow('successful disposal');
    expect(f.live.current()).toBeNull(); expect(f.created()).toEqual([f.home.instance]);
    expect(f.claims().filter(row => [f.home.instance, f.east.instance].includes(row.owner))).toHaveLength(1);
    expect(f.live.state().issues[`cleanup:${f.home.instance}`]).toContain('kept disposal refused');
  } finally { f.close(); }
});

test('G663: a crossing retires the source just left before the destination allocates', async () => {
  const f = await fixture();
  try {
    await f.enterHome();
    await f.cross(f.home.instance, f.east.instance);
    expect(f.live.state().current).toBe(f.east.instance);
    expect(f.live.state().residents).toEqual([f.east.instance]);
    expect(f.events.indexOf(`disposed:${f.home.instance}`)).toBeGreaterThan(-1);
    expect(f.events.indexOf(`disposed:${f.home.instance}`)).toBeLessThan(f.events.indexOf(`create:${f.east.instance}`));
    expect(f.allocated.find(row => row.instance === f.east.instance)?.owners).not.toContain(f.home.instance);
    expect(f.live.state().issues).toEqual({});
  } finally { f.close(); }
});

test('G663: a U-turn back into the source just left re-activates it', async () => {
  const f = await fixture();
  try {
    await f.enterHome();
    await f.cross(f.home.instance, f.home.instance);
    expect(f.live.state().current).toBe(f.home.instance);
    expect(f.created()).toEqual([f.home.instance]);
    expect(f.events.filter(event => event.startsWith('retire:'))).toEqual([]);
  } finally { f.close(); }
});

test('a throwing source disposal stays fully charged and prevents the destination allocating', async () => {
  const f = await fixture();
  try {
    expect(f.live.ready(null)).toBe(true);
    expect(f.live.ready(f.home.instance)).toBe(false);
    await f.enterHome();
    expect(f.live.ready(f.home.instance)).toBe(true);
    f.control.dispose = false;
    await expect(f.cross(f.home.instance, f.east.instance)).rejects.toThrow('successful disposal');
    expect(f.created()).toEqual([f.home.instance]);
    expect(f.claims().some(row => row.owner === f.home.instance && row.bytes === 1000)).toBe(true);
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(false);
    expect(f.live.state().issues[`cleanup:${f.home.instance}`]).toContain('kept disposal refused');
    expect(f.live.ready(f.home.instance)).toBe(false);
    expect(f.live.ready(f.east.instance)).toBe(false);
  } finally { f.close(); }
  expect(f.live.ready(null)).toBe(false);
  expect(f.live.ready(f.home.instance)).toBe(false);
});

test('prepared eviction closes readiness until its original abort restores it', async () => {
  const f = await fixture();
  try {
    await f.enterHome();
    const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    expect(f.live.ready(f.home.instance)).toBe(true);
    const eviction = f.live.prepareUnload(f.home.instance);
    if (eviction === null) throw new Error('Missing prepared eviction');
    expect(f.live.ready(f.home.instance)).toBe(false);
    eviction.abort();
    expect(f.live.ready(f.home.instance)).toBe(true);
  } finally { f.close(); }
});

test('T7: a cold road prediction allocates no world before its actual destination', async () => {
  const pins: { instance: string; start: { readonly x: number; readonly z: number }; signal: AbortSignal }[] = [];
  const f = await fixture({ tilePreparation: true, tilePins: pins });
  try {
    await f.live.prefetch([f.east.instance]);
    f.player.position.x = CHUNK_HALF + .5; travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(pins[0]?.instance).toBe(f.east.instance); expect(f.created()).toEqual([]);
    f.player.position.x = 0; f.player.position.z = -(CHUNK_HALF + .5);
    const north = await f.live.prepare(null, f.north.instance); north.commit();
    expect(f.created()).toEqual([f.north.instance]);
    expect(f.live.state().current).toBe(f.north.instance); expect(f.live.state().residents).toEqual([f.north.instance]);
    expect(f.claims().some(row => row.owner === f.home.instance || row.owner === f.east.instance)).toBe(false);
    expect(f.live.state().issues).toEqual({});
  } finally { f.close(); }
  expect(pins[0]?.signal.aborted).toBe(true);
});

test('T7: road prediction preserves source metadata for a real U-turn', async () => {
  const f = await fixture();
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.player.position.x = CHUNK_HALF + .5; f.player.position.z = 0;
    travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(f.live.state().residents).toEqual([]); expect(f.created()).toEqual([f.home.instance]);
    expect(f.events.filter(event => event.startsWith('retire:'))).toEqual([`retire:${f.home.instance}`]);
    const back = await f.live.prepare(null, f.home.instance); back.commit();
    expect(f.live.current()).toBe(f.home.instance); expect(f.created()).toEqual([f.home.instance, f.home.instance]);
  } finally { f.close(); }
});

test('T7: a long road excursion retains no whole source world or claim', async () => {
  const f = await fixture();
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.player.position.x = f.east.origin.x * 4; f.player.position.z = f.east.origin.x * 4;
    for (let tick = 0; tick < 600; tick++) f.live.beforeFixed();
    await f.settle();
    expect(f.live.state().residents).toEqual([]); expect(f.created()).toEqual([f.home.instance]);
    expect(f.entries().find(row => row.owner === f.home.instance)).toBeUndefined();

  } finally { f.close(); }
});


test('T7: later boulevard junctions do not delay the nearest render pin', async () => {
  const tiles: string[] = [], f = await fixture({ paired: true, allNeighbours: true, horizonSeconds: 30, tilePreparation: true, tileApproaches: tiles });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    const assembly = new GridAssembly({ developer: false, devserver: false });
    const later = assembly.cells.find(cell => cell.origin.x === f.east.origin.x && cell.origin.z === assembly.pitch);
    if (later === undefined) throw new Error('Missing later junction');
    await f.live.prefetch([f.east.instance, later.instance]);
    f.player.position.x = f.east.origin.x / 2; f.player.position.z = -100;
    travel(f.live, f.player.position, 0, 1); await f.settle();
    expect(tiles).toEqual([f.east.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.created()).toEqual([f.home.instance]); expect(f.live.state().residents).toEqual([]);
  } finally { f.close(); }
});

test('T7: equal turn choices stay unpinned until lateral movement names a side', async () => {
  const tiles: string[] = [], f = await fixture({ paired: true, allNeighbours: true, tilePreparation: true, tileApproaches: tiles });
  try {
    await f.enterHome(); await f.cross(f.home.instance, f.north.instance);
    const leave = await f.live.prepare(f.north.instance, null); leave.commit();
    await f.live.prefetch([f.home.instance, f.east.instance]);
    f.player.position.x = f.east.origin.x / 2; f.player.position.z = -100;
    travel(f.live, f.player.position, 0, 1); await f.settle();
    expect(tiles).toEqual([]); expect(f.live.ready(f.east.instance)).toBe(false); expect(f.live.ready(f.home.instance)).toBe(false);
    travel(f.live, f.player.position, .01, 1); await f.settle(); expect(tiles).toEqual([]);
    travel(f.live, f.player.position, .1, 1); await f.settle();
    expect(tiles).toEqual([f.east.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    expect(f.live.current()).toBeNull(); expect(f.live.state().residents).toEqual([]);
    expect(f.events).toContain(`retire:${f.north.instance}`);
  } finally { f.close(); }
});

test('T7: a redirected actual entry waits for the obsolete constructor claim', async () => {
  const f = await fixture({ paired: true }), failure = new Error('Stopped at constructor safe point');
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.holdIncoming = true;
    const first = f.live.prepare(null, f.east.instance), refused = expect(first).rejects.toBe(failure);
    await f.settle(); const entering = f.live.prepare(null, f.north.instance);
    await f.live.prefetch([f.north.instance]);
    expect(f.created()).toEqual([f.home.instance, f.east.instance]); expect(f.live.ready(f.north.instance)).toBe(false);
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(true);
    if (f.control.reject === undefined) throw new Error('Missing constructor safe point');
    f.control.reject(failure); await refused;
    const next = await entering; next.commit();
    expect(f.claims().some(row => row.owner === f.east.instance)).toBe(false);
    expect(f.live.ready(f.north.instance)).toBe(true); expect(f.created()).toEqual([f.home.instance, f.east.instance, f.north.instance]);
    expect(f.live.state().residents).toEqual([f.north.instance]); expect(f.events).toContain(`retire:${f.home.instance}`);
    expect(f.live.refusal(f.east.instance)).toBe(failure); expect(f.live.state().issues[f.north.instance]).toBeUndefined();
    expect(f.allocated.at(-1)?.owners).not.toContain(f.east.instance);
  } finally { f.control.finish?.(); f.close(); }
});


test('G743: an actual crossing demand cannot be cancelled by a later speculative heading', async () => {
  const f = await fixture({ paired: true });
  try {
    await f.enterHome(); const leave = await f.live.prepare(f.home.instance, null); leave.commit();
    f.control.holdIncoming = true; await f.live.prefetch([f.east.instance]);
    await f.live.prefetch([f.north.instance]);
    const demanded = f.live.prepare(null, f.east.instance); void demanded.catch(() => undefined); await f.settle();
    f.player.position.x = 0; f.player.position.z = -(CHUNK_HALF + .5);
    travel(f.live, f.player.position, 0, -1);
    for (let step = 0; step < 4; step++) { f.player.position.z -= 1; f.live.beforeFixed(); }
    expect(f.control.aborted).toEqual([]);
    expect(f.created()).toEqual([f.home.instance, f.east.instance]);
    if (f.control.finish === undefined) throw new Error('Missing demanded constructor');
    f.control.finish(); const prepared = await demanded; prepared.cancel();
    expect(f.live.ready(f.east.instance)).toBe(true);
    expect(f.live.state().issues).toEqual({});
  } finally { f.control.finish?.(); f.close(); }
});


test('a verified render approach holds destination read priority only through finite preparation', async () => {
  let finish = (): void => undefined;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const priorities: string[] = [], tiles: string[] = [];
  const f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles, priorities, tileReady: () => ready });
  try {
    await f.enterHome(); await f.live.prefetch([f.east.instance]); priorities.length = 0;
    f.player.position.x = CHUNK_HALF - 30;
    travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(tiles).toEqual([f.east.instance]); expect(priorities).toEqual([`hold:${f.east.instance}`]);
    expect(f.created()).toEqual([f.home.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
    finish(); await f.settle();
    expect(priorities).toEqual([`hold:${f.east.instance}`, `release:${f.east.instance}`]);
    expect(f.created()).toEqual([f.home.instance]); expect(f.live.current()).toBe(f.home.instance);
  } finally { finish(); f.close(); }
});

test('an abandoned render approach releases read priority after its pending work drains', async () => {
  let refuse = (_error: Error): void => undefined;
  const ready = new Promise<void>((_resolve, reject) => { refuse = reject; });
  const priorities: string[] = [], tiles: string[] = [];
  const f = await fixture({ paired: true, tilePreparation: true, tileApproaches: tiles, priorities, tileReady: () => ready });
  try {
    await f.enterHome(); await f.live.prefetch([f.east.instance]); priorities.length = 0;
    f.player.position.x = CHUNK_HALF - 30;
    travel(f.live, f.player.position, 1, 0); await f.settle();
    expect(priorities).toEqual([`hold:${f.east.instance}`]);
    f.live.dispose(); expect(priorities).toEqual([`hold:${f.east.instance}`]);
    refuse(new Error('Aborted tile preparation')); await f.settle();
    expect(priorities).toEqual([`hold:${f.east.instance}`, `release:${f.east.instance}`]);
    expect(f.created()).toEqual([f.home.instance]); expect(f.live.ready(f.east.instance)).toBe(false);
  } finally { refuse(new Error('Fixture cleanup')); f.close(); }
});
