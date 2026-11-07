import { expect, test, vi } from 'vitest';
import { preparationAdmission } from '../src/client/game/grid/preparationAdmission';
import type { LiveGridAdmission, LiveGridRegion } from '../src/client/game/grid/live';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { SimHost } from '@wildshard/engine/sim';
import { GridCrossing } from '../src/shared/game/grid/crossing';

function prepareFixture(prepare: () => Promise<LiveGridAdmission>) { return preparationAdmission(prepare, prepare); }

function region(dispose: () => void): LiveGridRegion { return { host: legacyDouble<SimHost>({}), dispose }; }

function claim() {
  const allocator = new ResidencyAllocator();
  const lease = allocator.reserve({ id: 'prepared-world', category: 'sim', owner: 'test', bytes: 1, distance: 0, needed: true });
  if (lease === null) throw new Error('Missing test claim');
  return lease;
}

test('G723: metadata retains the explicit isolation capability but fresh preparation must match it', async () => {
  const create = vi.fn<LiveGridAdmission['create']>(), cancel = vi.fn<() => void>();
  const metadata = { bytes: 1, isolatedPreparation: true };
  const admitted = await preparationAdmission(() => Promise.resolve(metadata), () => Promise.resolve({ bytes: 1, create, cancel }));
  const lease = claim();
  try {
    expect(admitted).toMatchObject({ isolatedPreparation: true });
    await expect(admitted.create(lease)).rejects.toThrow('isolation');
    expect(create).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  } finally { lease.release(); }
});

test('prefetch releases its input lease and cached admission reacquires on every visit', async () => {
  const events: string[] = [];
  const metadata: boolean[] = [];
  let next = 0;
  const prepare = (keepMetadata: boolean): Promise<LiveGridAdmission> => {
    metadata.push(keepMetadata);
    const visit = ++next; let active = true;
    events.push(`acquire:${visit}`);
    const cancel = (): void => { if (active) { active = false; events.push(`release:${visit}`); } };
    return Promise.resolve({ bytes: 42, exclusiveRuntime: true, prepareRuntime: () => { events.push('runtime'); return Promise.resolve(); }, cancel,
      create: () => {
        expect(active).toBe(true); events.push(`world:${visit}`);
        return Promise.resolve(region(cancel));
      } });
  };
  const admitted = await preparationAdmission(() => prepare(true), () => prepare(false)), lease = claim();
  try {
    expect(events).toEqual(['acquire:1', 'release:1']);
    expect(admitted.bytes).toBe(42); expect(admitted.exclusiveRuntime).toBe(true);
    await admitted.prepareRuntime?.();
    const first = await admitted.create(lease); first.dispose();
    const second = await admitted.create(lease); second.dispose();
    expect(events).toEqual(['acquire:1', 'release:1', 'runtime', 'acquire:2', 'world:2', 'release:2', 'acquire:3', 'world:3', 'release:3']);
    expect(metadata).toEqual([true, false, false]);
  } finally { lease.release(); }
});

test('failed verified reacquisition never starts a world', async () => {
  const create = vi.fn<LiveGridAdmission['create']>(), cancel = vi.fn<() => void>(); let calls = 0;
  const admitted = await prepareFixture(() => {
    if (++calls > 1) return Promise.reject(new Error('hash mismatch'));
    return Promise.resolve({ bytes: 1, cancel, create });
  });
  const lease = claim();
  try { await expect(admitted.create(lease)).rejects.toThrow('hash mismatch'); expect(create).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); }
  finally { lease.release(); }
});

test('cancellation during reacquisition releases the fresh lease without constructing', async () => {
  let resume: ((value: LiveGridAdmission) => void) | undefined;
  const cancel = vi.fn<() => void>(), create = vi.fn<LiveGridAdmission['create']>(); let calls = 0;
  const admitted = await prepareFixture(() => ++calls === 1 ? Promise.resolve({ bytes: 1, create }) : new Promise<LiveGridAdmission>(resolve => { resume = resolve; }));
  const lease = claim();
  try {
    const pending = admitted.create(lease); admitted.cancel?.();
    if (resume === undefined) throw new Error('Missing reacquisition gate'); resume({ bytes: 1, cancel, create });
    await expect(pending).rejects.toThrow('cancelled'); expect(create).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  } finally { lease.release(); }
});

test('cancellation keeps inputs pinned until a running build settles, then disposes the unpublished world', async () => {
  let finish: ((value: LiveGridRegion) => void) | undefined;
  const cancel = vi.fn<() => void>(), dispose = vi.fn<() => void>(); let calls = 0;
  const admitted = await prepareFixture(() => Promise.resolve({ bytes: 1, cancel: ++calls === 1 ? () => undefined : cancel,
    create: () => new Promise<LiveGridRegion>(resolve => { finish = resolve; }) }));
  const lease = claim();
  try {
    const pending = admitted.create(lease); await Promise.resolve(); await Promise.resolve();
    admitted.cancel?.(); expect(cancel).not.toHaveBeenCalled();
    if (finish === undefined) throw new Error('Missing build gate'); finish(region(dispose));
    await expect(pending).rejects.toThrow('cancelled'); expect(dispose).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
  } finally { lease.release(); }
});

test('same-cell metadata prefetch during construction preserves the checkpoint owner at departure', async () => {
  const owners = new Map<string, object>(), owner = {}, id = 'template-2';
  let finish: ((value: LiveGridRegion) => void) | undefined;
  const releaseInput = vi.fn<() => void>(), metadata = vi.fn(() => Promise.resolve({ bytes: 1, cancel: releaseInput }));
  const prepareWorld = vi.fn((): Promise<LiveGridAdmission> => {
    owners.set(id, owner);
    return Promise.resolve({ bytes: 1, cancel: () => { if (owners.get(id) === owner) owners.delete(id); },
      create: () => new Promise<LiveGridRegion>(resolve => { finish = resolve; }) });
  });
  const admitted = await preparationAdmission(metadata, prepareWorld), lease = claim();
  try {
    expect(prepareWorld).not.toHaveBeenCalled();
    const building = admitted.create(lease); await Promise.resolve(); await Promise.resolve();
    expect(owners.get(id)).toBe(owner);
    // LiveGridHost drops its product entry before awaiting create; radial
    // prefetch may therefore prepare the same cell while this world is pending.
    await preparationAdmission(metadata, prepareWorld);
    expect(prepareWorld).toHaveBeenCalledOnce(); expect(owners.get(id)).toBe(owner);
    if (finish === undefined) throw new Error('Missing world construction gate');
    finish(region(() => { owners.delete(id); })); const world = await building;
    const checkpoint = (): boolean => {
      if (!owners.has(id)) throw new Error('Regional durability was not admitted');
      return true;
    };
    const crossing = new GridCrossing(id, { prepare: () => Promise.resolve({ commit: () => undefined, cancel: () => undefined }),
      ready: () => true, checkpoint, stow: () => undefined, interior: () => undefined, changed: () => undefined });
    try {
      crossing.request(null); await Promise.resolve(); await Promise.resolve();
      expect(checkpoint()).toBe(true); expect(crossing.step(false)).toBe(true); expect(crossing.state().phase).toBe('settled');
    } finally { crossing.dispose(); world.dispose(); }
  } finally { lease.release(); }
});
