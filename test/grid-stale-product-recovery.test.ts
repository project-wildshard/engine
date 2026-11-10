import { installCatalogueFixture } from './fixtures/bootSetup';
import { afterEach, expect, test, vi } from 'vitest';
import { SaveStore } from '../src/shared/engine/saves/store';
import { installSaveEnvironment, saveEnvironment } from '../src/shared/engine/saves/environment';
import { markReload, type LastEnd } from '../src/client/engine/boot/lastEnd';
import { consumeTitleArrival, pendingTitleArrival, setTitleArrival } from '../src/client/engine/boot/titleArrival';
import { GridAssembly, type GridCell } from '../src/shared/game/grid/assembly';
import { gridRecovery, initialGridReload, plannedGridReload } from '../src/shared/game/grid/recovery';
import { pageGridIntents } from '../src/client/game/grid/intent';
import { bootPageMode, clearGridRecovery, consumeGridRecovery, gridRecoveryLoop } from '../src/client/game/grid/pageEntry';
import { travelService, travelSlot } from '../src/client/game/travel/travel';

await installCatalogueFixture();

class Storage {
  private readonly data = new Map<string, string>();
  blocked = false;
  get length(): number { return this.data.size; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.blocked) throw new Error('Storage blocked'); this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
}
const assembly = new GridAssembly({ developer: true, devserver: false });
const home: GridCell = (() => {
  const cell = assembly.at(0, 0);
  if (cell === undefined) throw new Error('Missing actual grid home');
  return cell;
})();
const previous: LastEnd = { kind: 'intentional', reason: 'stuck boot recovery (app older than its product)',
  at: 2000, build: 'old-build', mode: '', resident: '', slug: '', bootedAt: 2100, discarded: false, nav: 'navigate' };
const originalEnvironment = saveEnvironment();
afterEach(() => { clearGridRecovery(); consumeTitleArrival(home.slug); installSaveEnvironment(originalEnvironment); vi.restoreAllMocks(); });

function fixture() {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(2000);
  const local = new Storage(), session = new Storage();
  const store = new SaveStore({ local, session });
  const travel = travelService({ source: () => null, slot: travelSlot(store), now: () => Date.now(), navigate: () => undefined });
  travel.travel({ to: 'driftwood-isle', mode: 'enter' });
  setTitleArrival({ slug: home.slug, mode: 'enter' });
  clock.mockReturnValue(2100);
  return { store, clock, local, session, read: (end = previous, query = 'v=new') => consumeGridRecovery({
    assembly, saves: store, now: () => Date.now(), previous: end, search: new URLSearchParams(query),
  }) };
}

test('an older client stale reload resumes the actual home once without consuming its original handoffs', () => {
  const f = fixture();
  expect(f.read()?.instance).toBe(home.instance);
  expect(pendingTitleArrival(home.slug)).toEqual({ slug: home.slug, mode: 'enter' });
  expect(travelSlot(f.store).peek()?.to).toBe(home.slug);
  expect(f.read()).toBeNull();
  expect(gridRecoveryLoop()).toBe(true);
});

test('a grid kill resumes its durable location after sessionStorage is replaced', () => {
  const f = fixture(), record = f.read();
  if (record === null) throw new Error('Missing admitted road');
  const original = gridRecovery(f.store, () => Date.now());
  expect(original.save(assembly, home, record.road, { kind: 'road' })).toBe(true);
  expect(original.clearLoop()).toBe(true);
  const next = new SaveStore({ local: f.local, session: new Storage() });
  const resumed = consumeGridRecovery({ assembly, saves: next, now: () => Date.now(), unexpected: true,
    previous: { ...previous, kind: 'unexpected', mode: 'grid' } });
  expect(resumed).toMatchObject({ slug: home.slug, instance: home.instance, reason: 'reload', saved: { location: { kind: 'road' } } });
  expect(consumeGridRecovery({ assembly, saves: next, now: () => Date.now(), unexpected: true,
    previous: { ...previous, kind: 'unexpected', mode: 'grid' } })).toBeNull();
  expect(gridRecoveryLoop()).toBe(true);
});

test('SR4: a grid kill resumes its place only where the server durably stands', () => {
  const f = fixture(), record = f.read();
  if (record === null) throw new Error('Missing admitted road');
  const original = gridRecovery(f.store, () => Date.now());
  expect(original.save(assembly, home, record.road, { kind: 'road' })).toBe(true);
  expect(original.clearLoop()).toBe(true);
  const other = assembly.cells.find(cell => cell.instance !== home.instance);
  if (other === undefined) throw new Error('Missing a second catalogue cell');
  const crash = (server: readonly { site: string | null }[]) => consumeGridRecovery({ assembly, saves: new SaveStore({ local: f.local, session: new Storage() }),
    now: () => Date.now(), unexpected: true, previous: { ...previous, kind: 'unexpected', mode: 'grid' }, server });
  // Chromium lost the page's newer place: the server's site says a cell, the page's says the road. The title's tap resumes the server.
  expect(crash([{ site: other.instance }, { site: null }])).toBeNull();
  expect(gridRecoveryLoop()).toBe(false);
  // A site this catalogue has no cell for is skipped, as the server's own boot skips it; the next one agrees.
  expect(crash([{ site: 'gone-cell' }, { site: null }])).toMatchObject({ instance: home.instance, saved: { location: { kind: 'road' } } });
});

test('explicit RELOAD discards its pending grid recovery and stays at the title', () => {
  const f = fixture();
  expect(f.read({ ...previous, reload: true, mode: 'grid' })).toBeNull();
  expect(f.read({ ...previous, kind: 'fresh', reason: '', mode: '' })).toBeNull();
  expect(gridRecoveryLoop()).toBe(false);
});

test('the recorded grid mode survives a later stale admission after both original handoffs were consumed', () => {
  const f = fixture();
  consumeTitleArrival(home.slug);
  travelSlot(f.store).reset();
  const end = { ...previous, mode: 'grid' };
  expect(f.read(end)?.instance).toBe(home.instance);
  expect(f.read(end)).toBeNull();
  expect(gridRecoveryLoop()).toBe(true);
});

test('planned reloads continue at the saved pose; graphics recovery retains RESUME', () => {
  const f = fixture();
  const record = f.read({ ...previous, mode: 'grid' });
  if (record === null) throw new Error('Missing admitted stale-grid recovery');
  expect(initialGridReload(record)).toBe(true);
  expect(plannedGridReload(record)).toBe(true);
  expect(initialGridReload(undefined)).toBe(false);
  expect(initialGridReload(null)).toBe(false);
  expect(plannedGridReload(undefined)).toBe(false);
  expect(plannedGridReload(null)).toBe(false);
  for (const reason of ['gpu', 'background', 'new-game'] as const) {
    expect(initialGridReload({ ...record, reason })).toBe(false);
    expect(plannedGridReload({ ...record, reason })).toBe(false);
  }
  const service = gridRecovery(f.store, () => Date.now());
  expect(service.save(assembly, home, record.road, { kind: 'road' })).toBe(true);
  expect(service.clearLoop()).toBe(true);
  expect(service.write(assembly, home, record.road, 'reload')).toBe(true);
  const live = service.consume(assembly);
  if (live.kind !== 'resume') throw new Error('Missing admitted live recovery');
  expect(live.record.saved).toBeDefined();
  expect(initialGridReload(live.record)).toBe(false);
  expect(plannedGridReload(live.record)).toBe(true);
  for (const reason of ['gpu', 'background', 'new-game'] as const) {
    expect(plannedGridReload({ ...live.record, reason })).toBe(false);
  }
});

test.each([
  { kind: 'unexpected' as const }, { reason: 'new build adopted' }, { mode: 'shard' },
  { discarded: true }, { at: 3000 }, { at: -60_000 },
])('other lifecycle endings cannot revive an old consumed grid intent: %s', change => {
  expect(fixture().read({ ...previous, ...change })).toBeNull();
});

test.each(['', 'chunk=driftwood-isle&v=new', 'v=new&explore=hub'])('an ordinary or explicit route stays selected: %s', query => {
  expect(fixture().read(previous, query)).toBeNull();
});

test('expired arrivals and foreign or non-title travel cannot reconstruct a grid route', () => {
  const f = fixture();
  setTitleArrival({ slug: home.slug, mode: 'explore' });
  expect(f.read()).toBeNull();
  setTitleArrival({ slug: home.slug, mode: 'enter' });
  const handoff = travelSlot(f.store).peek();
  if (handoff === null) throw new Error('Missing original handoff');
  travelSlot(f.store).write({ ...handoff, to: 'sunscar-dunes' });
  expect(f.read()).toBeNull();
  travelSlot(f.store).write({ ...handoff, from: 'driftwood-isle' });
  expect(f.read()).toBeNull();
  travelSlot(f.store).write(handoff);
  f.clock.mockReturnValue(65_000);
  expect(f.read({ ...previous, at: 65_000 })).toBeNull();
});

test('a blocked durable recovery write cannot publish a compatibility route', () => {
  const f = fixture();
  f.local.blocked = true; f.session.blocked = true;
  expect(f.read()).toBeNull();
});

test('a current grid boot captures a planned reload before the world session is constructed', () => {
  vi.spyOn(Date, 'now').mockReturnValue(2100);
  vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(2000);
  const storage = new Storage();
  installSaveEnvironment({ storage: () => storage, persistent: () => true, persist: () => Promise.resolve(true) });
  const intent = pageGridIntents();
  intent.set({ instance: home.instance, slug: home.slug });
  expect(bootPageMode(home.slug)).toBe('grid');
  expect(markReload('stuck boot recovery (app older than its product)')).toBe(true);
  expect(consumeGridRecovery({ assembly })?.instance).toBe(home.instance);
  expect(intent.consume(home.slug)).toBeNull();
});
