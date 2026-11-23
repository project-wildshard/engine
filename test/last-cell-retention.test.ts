import { expect, test } from 'vitest';
import { BoxGeometry, Group } from 'three';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimLevel } from '@wildshard/engine/sim';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { LiveGridHost } from '../src/client/game/grid/live';
import { PageResidency } from '../src/client/game/grid/pageResidency';
import { ApproachInputsDeferredError } from '../src/client/game/grid/folderInputs';
import { NearPlaceholders } from '../src/client/game/grid/nearPlaceholderView';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const level: SimLevel = { version: 3, id: 'platform', seed: 1, ground: { size: 500, height: 0 },
  player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 30 }, entities: [], quests: [],
  weapon: { id: 'none', shape: { kind: 'point', radius: 0 }, windup: 0, active: 0, recover: 0, cooldown: 0, range: 0, damage: 0, tags: [] } };

async function fixture(options: { cap?: number; isolated?: boolean; keepHome?: number; keepNear?: number; ahead?: boolean; beforeAdmit?: (instance: string, required: boolean) => Promise<void> } = {}) {
  const rapier = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url))));
  const assembly = new GridAssembly({ developer: false, devserver: false }), home = assembly.cell('driftwood-isle');
  const next = assembly.cells.find(cell => cell.instance !== home.instance);
  if (next === undefined) throw new Error('Missing second cell');
  const page = createSimHost(level, { rapier }), residency = new PageResidency(), created: string[] = [], disposed: string[] = [];
  const objects = new Map<string, object>(), allocated: { instance: string; owners: string[] }[] = [];
  const expiries: { run: () => void; delay: number; cancelled: boolean }[] = [];
  const control = { dispose: true, checkpoint: true };
  const player = { position: leadPlayer(page).position, yaw: 0, health: leadPlayer(page).health, owner: leadPlayer(page), motor: leadPlayer(page).releaseMotor() };
  const live = new LiveGridHost(assembly, {
    home: { mode: 'owned', instance: home.instance, bytes: 50_000_000, residency: residency.admitHome(home.instance, 50_000_000) },
    player, allocator: residency.allocator,
    lastCell: { windowMs: 30_000, playingBytes: options.cap ?? CONTENT_CAPS.playing, ...(options.keepHome === undefined ? {} : { keepHome: options.keepHome }), ...(options.keepNear === undefined ? {} : { keepNear: options.keepNear }), schedule: (run, delay) => {
      const expiry = { run, delay, cancelled: false }; expiries.push(expiry); return () => { expiry.cancelled = true; };
    } },
    ...(options.ahead === true ? { ahead: { minSpeed: 8, margin: 1.25, leadMetres: 8 } } : {}),
    bindFrame: () => undefined, gameplayReady: () => true, prefetchable: () => false,
    highway: { bytes: 1000, create: () => ({ physics: page.physics, dispose: () => undefined }) },
    readiness: { link: { speed: 30, linkBitsPerSecond: 5_000_000, requestLatencySeconds: .25, maxStallSeconds: 3 },
      bundle: () => ({ criticalWireBytes: 1000, runtimePageWireBytes: 1000, decodeSeconds: 0, runtimeParseSeconds: 0 }) },
    admit: async (cell, required) => { await options.beforeAdmit?.(cell.instance, required === true); return { bytes: 50_000_000, exclusiveRuntime: true, isolatedPreparation: options.isolated !== false,
      prepareRuntime: () => Promise.resolve(), create: () => {
        created.push(cell.instance); objects.set(cell.instance, {});
        allocated.push({ instance: cell.instance, owners: [...residency.allocator.claims()].map(row => row.owner) });
        const host = createSimHost(level, { rapier, playerBody: false, ground: false });
        return Promise.resolve({ host, checkpoint: () => control.checkpoint, dispose: () => {
          if (!control.dispose) throw new Error('Retirement refused');
          disposed.push(cell.instance); host.dispose();
        } });
      } }; },
  });
  const enter = async (instance: string): Promise<void> => { const frame = await live.prepare(null, instance); frame.commit(); };
  const leave = async (): Promise<boolean> => {
    const from = live.current(); if (from === null) throw new Error('Missing entered cell');
    const frame = await live.prepare(from, null); frame.commit(); return live.retainDeparted(from);
  };
  const settle = async (): Promise<void> => { live.beforeFixed(); await live.prefetch([]); };
  return { live, player, home, next, assemblyPitch: assembly.pitch, residency, created, disposed, objects, allocated, expiries, control, enter, leave, settle,
    close: () => { control.dispose = true; live.dispose(); player.motor.dispose(); page.dispose(); residency.dispose(); } };
}

test('return reattaches the same complete world and fully charged claim without construction', async () => {
  const f = await fixture();
  try {
    await f.enter(f.home.instance); const object = f.objects.get(f.home.instance);
    expect(await f.leave()).toBe(true); await f.settle();
    expect(f.expiries[0]?.delay).toBe(30_000);
    expect(f.live.state().retainedCell?.instance).toBe(f.home.instance);
    const claim = f.residency.allocator.entries().find(row => row.id === `sim:${f.home.instance}`);
    expect(claim).toMatchObject({ bytes: 50_000_000, needed: false, holds: 0 });
    await f.enter(f.home.instance);
    expect(f.created).toEqual([f.home.instance]); expect(f.objects.get(f.home.instance)).toBe(object);
    expect(f.disposed).toEqual([]); expect(f.live.state().retainedCell).toBeNull();
    f.expiries[0]?.run(); expect(f.live.ready(f.home.instance)).toBe(true);
  } finally { f.close(); }
});

test('entering a different cell retires the kept world before the next allocation', async () => {
  const f = await fixture();
  try {
    await f.enter(f.home.instance); await f.leave(); await f.enter(f.next.instance);
    expect(f.disposed).toEqual([f.home.instance]); expect(f.expiries[0]?.cancelled).toBe(true);
    expect(f.allocated[1]?.owners).not.toContain(f.home.instance);
    expect(f.live.state().residents).toEqual([f.next.instance]);
  } finally { f.close(); }
});

test('expiry releases the world and claim without waiting for another fixed tick', async () => {
  const f = await fixture();
  try {
    await f.enter(f.home.instance); await f.leave(); f.expiries[0]?.run();
    expect(f.disposed).toEqual([f.home.instance]); expect(f.live.state().retainedCell).toBeNull();
    expect(f.residency.allocator.entries().some(row => row.owner === f.home.instance)).toBe(false);
    await f.enter(f.home.instance); expect(f.created).toEqual([f.home.instance, f.home.instance]);
  } finally { f.close(); }
});

test('optional pressure defers without releasing the retained world or its full charge', async () => {
  const f = await fixture();
  try {
    await f.enter(f.home.instance); const object = f.objects.get(f.home.instance);
    expect(await f.leave()).toBe(true);
    const before = f.residency.allocator.entries().find(row => row.id === `sim:${f.home.instance}`);
    const baseline = f.residency.allocator.ownerCost('optional').playing;
    const bytes = Math.floor((CONTENT_CAPS.playing - baseline) / CONTENT_CAPS.residentFactor) - 1000;
    const optional = f.residency.allocator.reserveIfFits({ id: 'optional', owner: 'optional', category: 'library', bytes, needed: true, distance: 0 });
    try {
      expect(optional).toBeNull(); expect(f.disposed).toEqual([]);
      expect(f.live.state().retainedCell?.instance).toBe(f.home.instance);
      expect(f.residency.allocator.entries().find(row => row.id === `sim:${f.home.instance}`)).toEqual(before);
      expect(f.residency.allocator.has('optional')).toBe(false);
      await f.enter(f.home.instance);
      expect(f.created).toEqual([f.home.instance]); expect(f.objects.get(f.home.instance)).toBe(object);
    } finally { optional?.release(); }
  } finally { f.close(); }
});

test('allocator pressure durably evicts an unneeded kept world before admitting replacement bytes', async () => {
  const f = await fixture();
  try {
    await f.enter(f.home.instance); await f.leave();
    const baseline = f.residency.allocator.ownerCost('pressure').playing;
    const bytes = Math.floor((CONTENT_CAPS.playing - baseline) / CONTENT_CAPS.residentFactor) - 1000;
    const lease = f.residency.allocator.reserve({ id: 'pressure', owner: 'pressure', category: 'library', bytes, needed: true, distance: 0 });
    try {
      expect(lease).not.toBeNull(); expect(f.disposed).toEqual([f.home.instance]);
      expect(f.live.state().retainedCell).toBeNull(); expect(f.live.ready(f.home.instance)).toBe(false);
    } finally { lease?.release(); }
  } finally { f.close(); }
});

test('retention refuses insufficient per-shard headroom and non-isolated factories', async () => {
  for (const options of [{ cap: 1 }, { isolated: false }]) {
    const f = await fixture(options);
    try { await f.enter(f.home.instance); expect(await f.leave()).toBe(false); await f.settle(); expect(f.expiries).toEqual([]); expect(f.disposed).toEqual([f.home.instance]); }
    finally { f.close(); }
  }
});

test('expiry during a prepared return cannot free its held world; cancellation makes it retireable', async () => {
  const f = await fixture();
  try {
    await f.enter(f.home.instance); await f.leave();
    const pending = f.live.prepare(null, f.home.instance); f.expiries[0]?.run();
    const frame = await pending;
    expect(f.disposed).toEqual([]); frame.cancel(); await f.settle();
    expect(f.disposed).toEqual([f.home.instance]); expect(f.live.state().retainedCell).toBeNull();
  } finally { f.close(); }
});

test('failed retained-world disposal remains charged and blocks another constructor', async () => {
  const f = await fixture();
  try {
    await f.enter(f.home.instance); await f.leave(); f.control.dispose = false; f.expiries[0]?.run();
    expect(f.residency.allocator.entries().some(row => row.owner === f.home.instance)).toBe(true);
    await expect(f.enter(f.next.instance)).rejects.toThrow('Exclusive runtime awaits successful disposal');
    expect(f.created).toEqual([f.home.instance]);
  } finally { f.close(); }
});

test('pressure cannot uncharge a retained world whose disposal failed', async () => {
  const f = await fixture();
  try {
    await f.enter(f.home.instance); await f.leave(); f.control.dispose = false;
    const baseline = f.residency.allocator.ownerCost('pressure').playing;
    const bytes = Math.floor((CONTENT_CAPS.playing - baseline) / CONTENT_CAPS.residentFactor) - 1000;
    expect(() => f.residency.allocator.reserve({ id: 'pressure', owner: 'pressure', category: 'library', bytes, needed: true, distance: 0 })).toThrow('Retained world disposal failed');
    expect(f.residency.allocator.entries().find(row => row.id === `sim:${f.home.instance}`)).toMatchObject({ bytes: 50_000_000, needed: true });
    expect(f.residency.allocator.has('pressure')).toBe(false);
    await expect(f.enter(f.next.instance)).rejects.toThrow('Exclusive runtime awaits successful disposal');
    expect(f.created).toEqual([f.home.instance]);
  } finally { f.close(); }
});


test('passive metadata deferral is revision bounded and cannot close a required entry', async () => {
  let attempts = 0;
  const f = await fixture({ beforeAdmit: (_instance, required) => {
    if (required) return Promise.resolve();
    attempts++; return Promise.reject(new ApproachInputsDeferredError());
  } });
  try {
    await f.enter(f.home.instance); expect(await f.leave()).toBe(true);
    await expect(f.live.prefetch([f.next.instance])).rejects.toBeInstanceOf(ApproachInputsDeferredError);
    expect(f.live.state().issues).toEqual({}); expect(f.live.refusal(f.next.instance)).toBeUndefined();
    await f.live.prefetch([f.next.instance]); expect(attempts).toBe(1);
    const change = f.residency.allocator.reserveIfFits({ id: 'revision', owner: 'revision', category: 'library', bytes: 1, needed: false, distance: 0 });
    if (change === null) throw new Error('Missing budget revision');
    try {
      await expect(f.live.prefetch([f.next.instance])).rejects.toBeInstanceOf(ApproachInputsDeferredError);
      expect(attempts).toBe(2); expect(f.live.state().retainedCell?.instance).toBe(f.home.instance);
      await f.enter(f.next.instance);
      expect(f.created).toEqual([f.home.instance, f.next.instance]); expect(f.live.ready(f.next.instance)).toBe(true);
      expect(f.live.state().issues).toEqual({});
    } finally { change.release(); }
  } finally { f.close(); }
});

test('required entry joined to pending passive metadata retries only typed deferral', async () => {
  let started = (): void => undefined, decline = (_error: Error): void => undefined;
  const began = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>((_resolve, reject) => { decline = reject; });
  const calls: boolean[] = [];
  const f = await fixture({ beforeAdmit: (_instance, required) => {
    calls.push(required); if (required) return Promise.resolve(); started(); return pending;
  } });
  try {
    const optional = f.live.prefetch([f.home.instance]); await began;
    const refused = expect(optional).rejects.toBeInstanceOf(ApproachInputsDeferredError);
    const entry = f.enter(f.home.instance); decline(new ApproachInputsDeferredError());
    await refused; await entry;
    expect(calls).toEqual([false, true]); expect(f.created).toEqual([f.home.instance]);
    expect(f.live.ready(f.home.instance)).toBe(true); expect(f.live.state().issues).toEqual({});
  } finally { f.close(); }
});

test.each(['radial', 'boulevard', 'explicit'] as const)('pending telemetry names %s metadata without claiming a world', async trigger => {
  let begin = (): void => undefined, finish = (): void => undefined;
  const began = new Promise<void>(resolve => { begin = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  const f = await fixture({ beforeAdmit: () => { begin(); return held; } });
  try {
    const pending = f.live.prefetch([f.next.instance], trigger); await began;
    expect(f.live.state().pending).toEqual([f.next.instance]);
    expect(f.live.state().pendingWork).toEqual([{ instance: f.next.instance, kind: 'optional-metadata', trigger }]);
    expect(f.created).toEqual([]);
    finish(); await pending;
    expect(f.live.state().pendingWork).toEqual([]);
  } finally { finish(); f.close(); }
});

test('required entry telemetry keeps world and required metadata distinct', async () => {
  let begin = (): void => undefined, finish = (): void => undefined;
  const began = new Promise<void>(resolve => { begin = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  const f = await fixture({ beforeAdmit: () => { begin(); return held; } });
  try {
    const pending = f.enter(f.home.instance); await began;
    expect(f.live.state().pending).toEqual([f.home.instance]);
    expect(f.live.state().pendingWork).toEqual([
      { instance: f.home.instance, kind: 'world', trigger: 'entry' },
      { instance: f.home.instance, kind: 'required-metadata', trigger: 'entry' },
    ]);
    finish(); await pending;
    expect(f.live.state().pendingWork).toEqual([]);
  } finally { finish(); f.close(); }
});

test('passive metadata corruption keeps its original refusal and is never promoted', async () => {
  const failure = new Error('Metadata hash mismatch'); let calls = 0;
  const f = await fixture({ beforeAdmit: () => { calls++; return Promise.reject(failure); } });
  try {
    await expect(f.live.prefetch([f.home.instance])).rejects.toBe(failure);
    expect(f.live.refusal(f.home.instance)).toBe(failure);
    await expect(f.enter(f.home.instance)).rejects.toThrow('Metadata hash mismatch');
    expect(calls).toBe(1); expect(f.created).toEqual([]);
  } finally { f.close(); }
});


test('an optional near view cannot evict the real retained world needed for return', async () => {
  const f = await fixture(); let near: NearPlaceholders | undefined;
  try {
    await f.enter(f.home.instance); const world = f.objects.get(f.home.instance);
    expect(await f.leave()).toBe(true);
    const baseline = f.residency.allocator.ownerCost(f.next.instance).playing;
    const bytes = Math.floor((CONTENT_CAPS.playing - baseline) / CONTENT_CAPS.residentFactor) - 1000;
    const root = new Group(), geometry = new BoxGeometry(), coverage: boolean[] = []; let discarded = false;
    geometry.addEventListener('dispose', () => { discarded = true; });
    near = new NearPlaceholders({ allocator: f.residency.allocator, cells: [f.next], pitch: f.assemblyPitch,
      root: () => root, mask: () => new Set<number>(), cover: (_instance, covered) => { coverage.push(covered); },
      load: () => Promise.resolve({ prepared: { geometry, look: { family: 'toon', haze: { colour: [1, 1, 1] } } }, bytes }) });
    near.update(f.next.origin, null); await Promise.resolve(); await Promise.resolve();
    expect(coverage).toEqual([]);
    expect(discarded).toBe(true); expect(root.children).toEqual([]);
    expect(f.live.state().retainedCell?.instance).toBe(f.home.instance);
    expect(f.disposed).toEqual([]);
    expect(f.residency.allocator.entries().find(row => row.id === `sim:${f.home.instance}`)?.bytes).toBe(50_000_000);
    await f.enter(f.home.instance);
    expect(f.created).toEqual([f.home.instance]); expect(f.objects.get(f.home.instance)).toBe(world);
  } finally { near?.dispose(); f.close(); }
});

test('ZE21: the owned home stays resident for the whole road, and allocator pressure never evicts it', async () => {
  const f = await fixture({ keepHome: Number.POSITIVE_INFINITY });
  try {
    await f.enter(f.home.instance); const object = f.objects.get(f.home.instance);
    expect(await f.leave()).toBe(true); await f.settle();
    // no time expiry (ZONE-ENTRY: the home stays resident while on the road)
    expect(f.expiries).toEqual([]);
    // far down the road (Jake: "1000m away shouldnt matter")
    f.player.position.x += 250 + 1500;
    for (let tick = 0; tick < 5; tick++) await f.settle();
    expect(f.live.state().retainedCell?.instance).toBe(f.home.instance); expect(f.disposed).toEqual([]);
    // a claim that only fits by evicting the home is refused: the neighbours' tiles yield to the home, never the reverse
    const baseline = f.residency.allocator.ownerCost('pressure').playing;
    const bytes = Math.floor((CONTENT_CAPS.playing - baseline) / CONTENT_CAPS.residentFactor) - 1000;
    const lease = f.residency.allocator.reserve({ id: 'pressure', owner: 'pressure', category: 'library', bytes, needed: false, distance: 0 });
    try { expect(f.disposed).toEqual([]); expect(f.live.state().retainedCell?.instance).toBe(f.home.instance); } finally { lease?.release(); }
    await f.settle();
    f.player.position.x -= 250 + 1500;
    await f.enter(f.home.instance);
    expect(f.created).toEqual([f.home.instance]); expect(f.objects.get(f.home.instance)).toBe(object);
  } finally { f.close(); }
});

// QA 11-23-b row 17 (J500, Jake 2026-11-23 ~13:05 Cancún, left Signal Dunes and walked back in: its far placeholder filled the view,
// then a void, then the zone). Any zone just left stays resident and needed while the traveller is on the road beside it, so the walk
// back in reattaches the same world; past that band it retires as before.
test('J500: a zone that is not the home stays resident on the road beside it, and retires past the band', async () => {
  const f = await fixture({ keepNear: 150 });
  try {
    // world x of the traveller: the live host keeps the feet local to the cell it stands in
    const at = (x: number): void => { f.player.position.x += x - f.live.worldFeet().x; f.player.position.z += f.next.origin.z - f.live.worldFeet().z; };
    await f.enter(f.next.instance); const object = f.objects.get(f.next.instance);
    at(f.next.origin.x);
    expect(await f.leave()).toBe(true); await f.settle();
    expect(f.expiries, 'no time expiry beside it').toEqual([]);
    expect(f.live.state().retainedCell?.instance).toBe(f.next.instance);
    // a step onto the road beside it: still kept, and allocator pressure never evicts it
    at(f.next.origin.x + 250 + 100);
    for (let tick = 0; tick < 3; tick++) await f.settle();
    expect(f.live.state().retainedCell?.instance).toBe(f.next.instance); expect(f.disposed).not.toContain(f.next.instance);
    // back in: the same world, never built again
    at(f.next.origin.x);
    await f.enter(f.next.instance);
    expect(f.created.filter(id => id === f.next.instance)).toHaveLength(1); expect(f.objects.get(f.next.instance)).toBe(object);
    // out again and past the band: it retires
    at(f.next.origin.x);
    expect(await f.leave()).toBe(true);
    at(f.next.origin.x + 250 + 400);
    for (let tick = 0; tick < 3; tick++) await f.settle();
    expect(f.live.state().retainedCell?.instance).not.toBe(f.next.instance); expect(f.disposed).toContain(f.next.instance);
  } finally { f.close(); }
});

// J500 rule 2 (QA 11-23-b row 17, Jake 2026-11-23: a zone you approach is drawn at full detail before you reach its gate). On the road
// the zone the traveller heads into builds its whole world once its readiness estimate at the traveller's speed covers the walk, so
// the crossing reattaches it with no build, and the road draws it (with the zone just left) from outside.
async function roadWalk(options: Parameters<typeof fixture>[0] = {}) {
  const f = await fixture({ keepNear: 150, ahead: true, ...options });
  const dx = f.next.origin.x - f.home.origin.x, dz = f.next.origin.z - f.home.origin.z, length = Math.hypot(dx, dz);
  // a point `metres` from the home's centre toward the next zone's centre (world metres)
  const along = (metres: number): { x: number; z: number } => ({ x: f.home.origin.x + dx / length * metres, z: f.home.origin.z + dz / length * metres });
  const at = (metres: number): void => { const p = along(metres), feet = f.live.worldFeet(); f.player.position.x += p.x - feet.x; f.player.position.z += p.z - feet.z; };
  /** one fixed step per half metre (30 m/s), as the page's fixed step runs */
  const walk = async (from: number, to: number): Promise<void> => {
    const step = to > from ? 0.5 : -0.5;
    for (let metres = from; step > 0 ? metres <= to : metres >= to; metres += step) { at(metres); await f.settle(); }
  };
  // the next zone's square edge on the line between the two centres
  const edge = length - 256 / Math.max(Math.abs(dx), Math.abs(dz)) * length;
  return { ...f, at, walk, edge, length };
}

test('J500 rule 2: heading along the road into a zone builds its world before the gate; the crossing builds nothing', async () => {
  const f = await roadWalk();
  try {
    f.at(0); await f.enter(f.home.instance); f.at(f.edge - 140); expect(await f.leave()).toBe(true);
    await f.walk(f.edge - 140, f.edge - 1);
    await f.live.prefetch([]); for (let tick = 0; tick < 3; tick++) await f.settle();
    expect(f.created.filter(id => id === f.next.instance), 'built on the road, ahead of its gate').toHaveLength(1);
    expect(f.live.ready(f.next.instance)).toBe(true);
    expect(f.live.state().ahead?.instance).toBe(f.next.instance);
    expect(f.live.drawnFromRoad(), 'the road draws the zone ahead and the zone just left').toEqual([f.home.instance, f.next.instance].sort());
    const object = f.objects.get(f.next.instance);
    f.at(f.edge + 8); await f.enter(f.next.instance);
    expect(f.created.filter(id => id === f.next.instance), 'the crossing reattaches it').toHaveLength(1);
    expect(f.objects.get(f.next.instance)).toBe(object);
    expect(f.live.drawnFromRoad(), 'nothing is drawn from outside while inside a zone').toEqual([]);
  } finally { f.close(); }
});

test('J500 rule 2: standing or turning away builds nothing ahead', async () => {
  const f = await roadWalk();
  try {
    f.at(0); await f.enter(f.home.instance); f.at(f.edge - 20); expect(await f.leave()).toBe(true);
    for (let tick = 0; tick < 30; tick++) await f.settle();
    expect(f.created, 'standing still is no heading').toEqual([f.home.instance]);
    await f.walk(f.edge - 20, f.edge - 40);
    expect(f.created, 'walking away from it').toEqual([f.home.instance]);
    expect(f.live.state().ahead?.instance ?? null).toBeNull();
  } finally { f.close(); }
});

test('J500: a ready return waits on no other zone built ahead', async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await roadWalk({ beforeAdmit: async (instance) => { if (instance !== 'driftwood-isle') await gate; } });
  try {
    f.at(0); await f.enter(f.home.instance); f.at(f.edge - 100); expect(await f.leave()).toBe(true);
    await f.walk(f.edge - 100, f.edge - 60);
    expect(f.live.state().ahead?.instance).toBe(f.next.instance);
    expect(f.live.ready(f.next.instance)).toBe(false);
    // back into the zone just left while the one ahead still builds: no wait on it
    f.at(f.edge - 290); await f.enter(f.home.instance);
    expect(f.live.current()).toBe(f.home.instance);
    release(); await f.live.prefetch([]); for (let tick = 0; tick < 3; tick++) await f.settle();
    await new Promise(resolve => setTimeout(resolve, 0)); for (let tick = 0; tick < 3; tick++) await f.settle();
    expect(f.live.state().residents, 'the zone built ahead retires once done').toEqual([f.home.instance]);
  } finally { release(); f.close(); }
});
