import { expect, test } from 'vitest';
import * as v from 'valibot';
import { ResidencyAllocator, type ResidencyClaim } from '../src/shared/game/grid/allocator';
import { ReferenceResidencyAllocator } from './fixtures/grid/allocator-before';
import { MemoryAdmission, type MemoryAdmissionRequest } from '@wildshard/format/memoryAdmission';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import recorded from './fixtures/grid/pine-ledger-sequence.json' with { type: 'json' };

type Ledger = Pick<ReferenceResidencyAllocator, 'reserve' | 'reservePageComponent' | 'markMeasuredPage' | 'cost' | 'entries' | 'has'>;
type LedgerLease = NonNullable<ReturnType<Ledger['reserve']>>;
function pair(playing?: number, developer = true) {
  return [new ReferenceResidencyAllocator({ ...(playing === undefined ? {} : { playing }), memory: new MemoryAdmission(() => developer) }),
    new ResidencyAllocator({ ...(playing === undefined ? {} : { playing }), memory: new MemoryAdmission(() => developer) })];
}
function same(ledgers: Ledger[]) {
  expect(ledgers[1]?.cost()).toEqual(ledgers[0]?.cost());
  expect(ledgers[1]?.entries()).toEqual(ledgers[0]?.entries());
}
function result<T>(run: () => T): T | string { try { return run(); } catch (error) { return String(error); } }
/** Committed evictions, in order: an eviction that cannot make room is no longer prepared and aborted claim by claim. */
const committed = (events: readonly string[] | undefined): string[] => (events ?? []).filter(event => event.startsWith('commit'));
const Claim = v.object({ id: v.string(), category: v.picklist(['l0', 'l1', 'far', 'near', 'library', 'sim', 'commons', 'product', 'page']),
  bytes: v.number(), owner: v.string(), distance: v.number(), needed: v.boolean(), coveredBy: v.exactOptional(v.string()) });

test('diagnostic snapshots stay detached across lease and coverage changes', () => {
  const ledger = new ResidencyAllocator({ memory: new MemoryAdmission(() => true) });
  const claim = { category: 'sim' as const, owner: 'test', distance: 10, needed: true, bytes: 400, id: 'parent' };
  const parent = ledger.reserve(claim);
  const child = ledger.reserve({ ...claim, id: 'child', category: 'commons', bytes: 200, coveredBy: 'parent' });
  if (parent === null || child === null) throw new Error('Fixture admission failed');
  const initial = ledger.entries(), oldParent = initial.find(row => row.id === 'parent');
  expect(initial.map(row => row.id)).toEqual(['child', 'parent']);
  expect(ledger.entries()).not.toBe(initial);
  expect(ledger.entries()[0]).toBe(initial[0]);
  const shared = ledger.reserve(claim), unhold = parent.hold();
  parent.update({ needed: false, distance: 30 });
  expect(ledger.entries().find(row => row.id === 'parent')).toMatchObject({ refs: 2, holds: 1, needed: false, distance: 30 });
  expect(oldParent).toMatchObject({ refs: 1, holds: 0, needed: true, distance: 10 });
  expect(Object.isFrozen(oldParent)).toBe(true);
  unhold(); shared?.release(); parent.release();
  expect(ledger.entries()).toEqual([expect.objectContaining({ id: 'child', accountedBytes: 200 })]);
  expect(initial[0]).toMatchObject({ id: 'child', accountedBytes: 0 });
  const next = ledger.reserve(claim);
  expect(ledger.entries()[0]).toMatchObject({ id: 'child', accountedBytes: 0 });
  next?.release(); child.release();
  expect(ledger.entries()).toEqual([]);
});

test('warning refresh preserves coverage totals, membership and notification reentry', () => {
  const runs = pair(CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + 1000).map(ledger => {
    const claim = { category: 'sim' as const, owner: 'a', distance: 0, needed: true };
    const parent = ledger.reserve({ ...claim, id: 'parent', bytes: 1200 });
    ledger.markMeasuredPage('parent');
    const child = ledger.reserve({ ...claim, category: 'commons', id: 'child', bytes: 900, coveredBy: 'parent' });
    const page = ledger.reservePageComponent('renderer', 60, 10, 'parent');
    const warned = ledger.reserve({ ...claim, category: 'library', id: 'warned', bytes: 1600 });
    const peer = ledger.reserve({ ...claim, owner: 'b', id: 'peer', bytes: 2400 });
    if (parent === null || child === null || page === null || warned === null || peer === null) throw new Error('Fixture admission failed');
    expect(ledger.memory.reports().map(row => row.owner)).toEqual(['a', 'b']);
    const trace: { reports: ReturnType<MemoryAdmission['reports']>; cost: ReturnType<Ledger['cost']>; entries: ReturnType<Ledger['entries']> }[] = [];
    const observe = () => { trace.push({ reports: ledger.memory.reports(), cost: ledger.cost(), entries: ledger.entries() }); };
    let reenter = false, reentries = 0;
    const unsubscribe = ledger.memory.subscribe(() => {
      observe();
      if (reenter) {
        reenter = false; reentries++;
        // Notifications run after the complete warning refresh. Their releases may synchronously refresh again.
        peer.release(); child.release();
      }
    });
    reenter = true;
    parent.release(); observe();
    expect(reentries).toBe(1);
    expect(ledger.memory.reports().map(row => [row.owner, row.accountedBytes])).toEqual([['a', 1660]]);
    const nextParent = ledger.reserve({ ...claim, id: 'parent', bytes: 600 });
    observe();
    warned.release(); observe();
    expect(ledger.memory.reports()).toEqual([]);
    nextParent?.release(); child.release(); page.release(); warned.release(); observe();
    unsubscribe();
    expect(ledger.entries()).toEqual([]);
    return trace;
  });
  expect(runs[1]).toEqual(runs[0]);
});

test('warning refresh uses shrunken claims before and after coverage retirement', () => {
  const memory = new MemoryAdmission(() => true);
  const ledger = new ResidencyAllocator({ playing: CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + 1000, memory });
  const claim = { category: 'sim' as const, owner: 'a', distance: 0, needed: true };
  const parent = ledger.reserve({ ...claim, id: 'parent', bytes: 1200 });
  const child = ledger.reserve({ ...claim, category: 'commons', id: 'child', bytes: 900, coveredBy: 'parent' });
  const warned = ledger.reserve({ ...claim, category: 'library', id: 'warned', bytes: 1600 });
  if (parent === null || child === null || warned === null) throw new Error('Fixture admission failed');
  warned.shrink(1400);
  expect(memory.reports()[0]?.accountedBytes).toBe(2600);
  parent.release();
  expect(memory.reports()[0]?.accountedBytes).toBe(2300);
  child.update({ coveredBy: null }); child.shrink(400);
  expect(memory.reports()[0]?.accountedBytes).toBe(1800);
  warned.shrink(100);
  expect(memory.reports()).toEqual([]);
  child.release(); warned.release();
  expect(ledger.entries()).toEqual([]);
});

test('recorded Pine retained allocations keep every admission and total identical', () => {
  const ledgers = pair(), parent = v.parse(Claim, recorded.parent), claims = v.parse(v.array(Claim), recorded.claims);
  const held = ledgers.map(ledger => {
    const lease = ledger.reserve(parent); ledger.markMeasuredPage(parent.id); return { lease, assets: [] as (LedgerLease | null)[] };
  });
  same(ledgers);
  for (const claim of claims) {
    const decisions = ledgers.map((ledger, i) => {
      const lease = ledger.reserve(claim); held[i]?.assets.push(lease); return lease !== null;
    });
    expect(decisions[1]).toBe(decisions[0]); same(ledgers);
  }
  // Retirement exposes still-retained covered allocations; the same parent id can later cover them again.
  for (const row of held) row.lease?.release(); same(ledgers);
  const again = ledgers.map(ledger => ledger.reserve(parent)); same(ledgers);
  for (const row of held) for (const lease of row.assets) lease?.release(); same(ledgers);
  for (const lease of again) lease?.release(); same(ledgers);
  expect(ledgers[1]?.memory.reports()).toEqual(ledgers[0]?.memory.reports());
}, 30_000);

test.each([false, true])('indexed coverage, holds, ordering and refusal match the original (Developer %s)', developer => {
  const ledgers = pair(CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + 1000, developer);
  const leases = ledgers.map(() => new Map<string, LedgerLease | null>()), unholds = ledgers.map(() => new Map<string, () => void>());
  const events = ledgers.map(() => [] as string[]);
  const run = (action: (ledger: Ledger, i: number) => unknown) => {
    const outcomes = ledgers.map((ledger, i) => result(() => action(ledger, i)));
    expect(outcomes[1]).toEqual(outcomes[0]); same(ledgers); expect(committed(events[1])).toEqual(committed(events[0]));
    expect(ledgers[1]?.memory.reports()).toEqual(ledgers[0]?.memory.reports());
  };
  const reserve = (key: string, claim: ResidencyClaim, evict = false, refuses = false) => run((ledger, i) => {
    const lease = ledger.reserve({ ...claim, ...(evict ? { prepareEvict: () => {
      events[i]?.push(`prepare:${key}`);
      return refuses ? null : { commit: () => { events[i]?.push(`commit:${key}`); }, abort: () => { events[i]?.push(`abort:${key}`); } };
    } } : {}) }); leases[i]?.set(key, lease); return lease !== null;
  });
  const base = { category: 'far' as const, owner: 'test', distance: 10, needed: false, bytes: 100 };
  reserve('a', { ...base, id: 'a' }, true); reserve('b', { ...base, id: 'b' }, true, true);
  reserve('c', { ...base, id: 'c' }, true); reserve('near', { ...base, id: 'near', category: 'near', bytes: 0 });
  run((_ledger, i) => { unholds[i]?.set('a', leases[i]?.get('a')?.hold() ?? (() => undefined)); });
  run((_ledger, i) => { leases[i]?.get('c')?.update({ distance: 50, needed: true }); });
  reserve('pressure', { ...base, id: 'pressure', bytes: 900, needed: true });
  run((_ledger, i) => { unholds[i]?.get('a')?.(); leases[i]?.get('c')?.update({ needed: false }); });
  reserve('pressure2', { ...base, id: 'pressure2', bytes: 600, needed: true });
  run((_ledger, i) => { leases[i]?.get('pressure')?.release(); leases[i]?.get('pressure2')?.release(); });
  reserve('parent', { ...base, id: 'parent', category: 'sim', bytes: 400, needed: true });
  run(ledger => { if (ledger.has('parent')) ledger.markMeasuredPage('parent'); });
  reserve('child', { ...base, id: 'child', category: 'commons', bytes: 200, coveredBy: 'parent' });
  reserve('overflow', { ...base, id: 'overflow', category: 'commons', bytes: 500, coveredBy: 'parent' });
  run((ledger, i) => { const lease = ledger.reservePageComponent('page', 100, 50, 'parent'); leases[i]?.set('page', lease); return lease !== null; });
  run((_ledger, i) => { leases[i]?.get('child')?.update({ coveredBy: null }); });
  run((_ledger, i) => { leases[i]?.get('child')?.update({ coveredBy: 'parent' }); });
  run((ledger, i) => { const lease = ledger.reservePageComponent('page', 120, 60); leases[i]?.set('page2', lease); return lease !== null; });
  run((_ledger, i) => { leases[i]?.get('parent')?.release(); });
  reserve('parent2', { ...base, id: 'parent', category: 'sim', bytes: 400, needed: true });
  run((_ledger, i) => { for (const lease of leases[i]?.values() ?? []) lease?.release(); });
});


test.each([false, true])('pressure projection preserves covered bytes when the parent is selected first: %s', parentFirst => {
  const playing = CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + 1000;
  const ledgers = pair(playing, false), events = ledgers.map(() => [] as string[]);
  for (const [i, ledger] of ledgers.entries()) {
    const prepare = (id: string) => () => ({ commit: () => { events[i]?.push(id); }, abort: () => undefined });
    const parent = ledger.reserve({ id: 'parent', owner: 'test', category: 'sim', bytes: 400, needed: true,
      distance: parentFirst ? 40 : 10, prepareEvict: prepare('parent') });
    if (parent === null) throw new Error('Missing parent fixture');
    ledger.markMeasuredPage('parent');
    ledger.reserve({ id: 'child', owner: 'test', category: 'commons', bytes: 200, needed: false,
      distance: 30, coveredBy: 'parent', prepareEvict: prepare('child') });
    const page = ledger.reservePageComponent('page', 100, 50, 'parent');
    page?.update({ needed: false, distance: 20 });
    // Keep the page component after the parent: its calibration and charge become independent.
    parent.update({ needed: false });
    ledger.reserve({ id: 'pressure', owner: 'test', category: 'far', bytes: 600, needed: true, distance: 0 });
  }
  same(ledgers); expect(events[1]).toEqual(events[0]);
});

test('thousands of idle cache claims are not even prepared when pressure cannot fit', () => {
  const ledger = new ResidencyAllocator({ memory: new MemoryAdmission(() => true) });
  let prepares = 0, aborts = 0, commits = 0;
  const leases: LedgerLease[] = [];
  for (let index = 0; index < 4000; index++) {
    const lease = ledger.reserve({ id: `cache:${String(index)}`, owner: 'cache', category: 'commons', bytes: 1, needed: true, distance: index,
      prepareEvict: () => { prepares++; return { commit: () => { commits++; }, abort: () => { aborts++; } }; } });
    if (lease === null) throw new Error('Missing cache fixture');
    leases.push(lease);
  }
  for (const lease of leases) lease.update({ needed: false });
  const before = ledger.entries(), cost = ledger.cost();
  const pressure = ledger.reserve({ id: 'pressure', owner: 'other', category: 'sim', bytes: CONTENT_CAPS.playing, needed: true, distance: 0 });
  expect(pressure).not.toBeNull(); expect(prepares).toBe(0); expect(aborts).toBe(0); expect(commits).toBe(0);
  pressure?.release(); expect(ledger.entries()).toEqual(before); expect(ledger.cost()).toEqual(cost);
});

test('idle covered caches free nothing, so pressure they cannot fit prepares none of them (Nine entry)', () => {
  // the parent covers 4000 idle caches: the raw-byte bound saw 8000 bytes of room, evicting them frees none
  const playing = CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + Math.ceil(12_000 * CONTENT_CAPS.residentFactor);
  const ledgers = pair(playing, true), prepares = [0, 0];
  for (const [i, ledger] of ledgers.entries()) {
    ledger.reserve({ id: 'sim:nine', owner: 'nine', category: 'sim', bytes: 10_000, needed: true, distance: 0 });
    ledger.markMeasuredPage('sim:nine');
    for (let index = 0; index < 4000; index++) ledger.reserve({ id: `cache:${String(index)}`, owner: 'platform', category: 'commons', bytes: 2,
      needed: false, distance: index, coveredBy: 'sim:nine', prepareEvict: () => { prepares[i] = (prepares[i] ?? 0) + 1; return { commit: () => undefined, abort: () => undefined }; } });
  }
  same(ledgers);
  for (let round = 0; round < 3; round++) {
    const decisions = ledgers.map(ledger => ledger.reserve({ id: `pressure:${String(round)}`, owner: 'nine', category: 'far', bytes: 6000, needed: true, distance: 0 }) !== null);
    expect(decisions[1]).toBe(decisions[0]); same(ledgers);
  }
  expect(prepares[0]).toBe(12_000); expect(prepares[1]).toBe(0);
  expect(ledgers[1]?.memory.reports()).toEqual(ledgers[0]?.memory.reports());
});

test('pressure planning rebases when an eviction preparation changes a live allocation', () => {
  const ledgers = pair(CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + 1000, false);
  const events = ledgers.map(() => [] as string[]);
  for (const [i, ledger] of ledgers.entries()) {
    const peer = ledger.reserve({ id: 'peer', owner: 'test', category: 'far', bytes: 200, needed: true, distance: 0 });
    ledger.reserve({ id: 'first', owner: 'test', category: 'far', bytes: 200, needed: false, distance: 2,
      prepareEvict: () => { peer?.release(); return { commit: () => { events[i]?.push('first'); }, abort: () => { events[i]?.push('abort'); } }; } });
    ledger.reserve({ id: 'pressure', owner: 'test', category: 'sim', bytes: 600, needed: true, distance: 0 });
  }
  same(ledgers); expect(events[1]).toEqual(events[0]);
});


test('evicting a parent also exposes the pending covered allocation', () => {
  const ledgers = pair(CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + Math.ceil(800 * CONTENT_CAPS.residentFactor));
  const events = ledgers.map(() => [] as string[]);
  for (const [i, ledger] of ledgers.entries()) {
    const parent = ledger.reserve({ id: 'parent', owner: 'parent', category: 'sim', bytes: 400, needed: true, distance: 1,
      prepareEvict: () => ({ commit: () => { events[i]?.push('commit'); }, abort: () => { events[i]?.push('abort'); } }) });
    ledger.reserve({ id: 'anchor', owner: 'other', category: 'far', bytes: 600, needed: true, distance: 0 });
    parent?.update({ needed: false });
    ledger.reserve({ id: 'pending', owner: 'parent', category: 'commons', bytes: 300, needed: true, distance: 0, coveredBy: 'parent' });
  }
  same(ledgers); expect(events[1]).toEqual(['abort']); expect(events[1]).toEqual(events[0]);
});

/** Records every over-budget admission request (its accounted owner bytes included) before judging it as usual. */
class RecordedAdmission extends MemoryAdmission {
  readonly requests: MemoryAdmissionRequest[] = [];
  override accept(request: MemoryAdmissionRequest): boolean { this.requests.push(request); return super.accept(request); }
}

test('over-budget admissions report the same owner totals as the scanning allocator, across coverage changes', () => {
  const reference = new RecordedAdmission(() => true), indexed = new RecordedAdmission(() => true);
  const ledgers = [new ReferenceResidencyAllocator({ playing: 4_000_000, memory: reference }), new ResidencyAllocator({ playing: 4_000_000, memory: indexed })];
  const run = (claim: ResidencyClaim) => ledgers.map(ledger => ledger.reserve(claim));
  const parents = run({ id: 'sim:orchard', category: 'sim', owner: 'orchard', bytes: 3_000_000, distance: 0, needed: true });
  for (const ledger of ledgers) ledger.markMeasuredPage('sim:orchard');
  const covered = Array.from({ length: 6 }, (_, i) => run({ id: `commons:orchard-${String(i)}`, category: 'commons', owner: 'orchard', bytes: 200_000, distance: 0, needed: true, coveredBy: 'sim:orchard' }));
  // past the envelope: every needed claim is judged by the owner's running total (covered children at 0)
  const held = Array.from({ length: 40 }, (_, i) => run({ id: `l0:${i % 2 === 0 ? 'orchard' : 'harbour'}-${String(i)}`, category: 'l0', owner: i % 2 === 0 ? 'orchard' : 'harbour', bytes: 150_000, distance: i, needed: true }));
  // the measured parent leaves: its children are charged again; then more claims past the envelope
  for (const lease of parents) lease?.release();
  held.push(...Array.from({ length: 10 }, (_, i) => run({ id: `l1:orchard-${String(i)}`, category: 'l1', owner: 'orchard', bytes: 90_000, distance: i, needed: true })));
  for (const lease of covered.flat()) lease?.release();
  held.push(run({ id: 'l1:orchard-late', category: 'l1', owner: 'orchard', bytes: 90_000, distance: 0, needed: true }));
  expect(indexed.requests.length).toBeGreaterThan(20);
  expect(indexed.requests).toEqual(reference.requests);
  expect(held.map(pairs => pairs.map(lease => lease !== null))).toEqual(held.map(pairs => [pairs[0] !== null, pairs[0] !== null]));
  same(ledgers);
});

test('many idle claims evicted a few at a time leave in the original order with the same bytes', () => {
  const playing = CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + 20_000;
  const ledgers = pair(playing, false), events = ledgers.map(() => [] as string[]), held = ledgers.map(() => [] as (LedgerLease | null)[]);
  const claim = (i: number, ledger: Ledger, at: number) => ledger.reserve({ id: `idle-${String(i).padStart(4, '0')}`, owner: i % 3 === 0 ? 'a' : 'b',
    category: i % 2 === 0 ? 'far' : 'l1', bytes: 40 + (i % 7) * 13, needed: false, distance: (i * 37) % 101,
    prepareEvict: () => (i % 11 === 5 ? null : { commit: () => { events[at]?.push(`commit:${i}`); }, abort: () => { events[at]?.push(`abort:${i}`); } }) });
  for (const [at, ledger] of ledgers.entries()) for (let i = 0; i < 400; i++) held[at]?.push(claim(i, ledger, at));
  same(ledgers);
  // each needed claim evicts a few idle ones; departures between them keep the rest in order
  for (let round = 0; round < 40; round++) {
    const decisions = ledgers.map((ledger, at) => {
      if (round % 5 === 4) held[at]?.[round * 3]?.release();
      const lease = ledger.reserve({ id: `need-${round}`, owner: 'c', category: 'near', bytes: 150 + round * 9, needed: true, distance: 0 });
      held[at]?.push(lease); return lease !== null;
    });
    expect(decisions[1]).toBe(decisions[0]); same(ledgers);
    expect(committed(events[1])).toEqual(committed(events[0]));
  }
  expect(committed(events[0]).length).toBeGreaterThan(40);
});
