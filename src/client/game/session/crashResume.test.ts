import { afterEach, expect, test, vi } from 'vitest';
import { consumeCrashResume, installCrashCheckpoint, saveCrashPosition } from './crashResume';
import type { LastEnd } from '@wildshard/engine/boot/lastEnd';
import { Scope } from '@wildshard/engine/app/scope';
import { SaveStore, type SaveStorage } from '@wildshard/engine/saves/store';

class Storage implements SaveStorage {
  private readonly values = new Map<string, string>();
  blocked = false;
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.blocked) throw new Error('Storage blocked'); this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
const pose = { x: 32, y: 4, z: -61, yaw: 1.4, pitch: -0.3 };
const end: LastEnd = { kind: 'unexpected', reason: 'killed', at: 12_000, bootedAt: 15_000, slug: 'coast', mode: 'shard', resident: '', build: 'old', discarded: false, nav: 'navigate' };
const available = [{ slug: 'coast' }, { slug: 'forest' }];
afterEach(() => { vi.useRealTimers(); });
function fixture() { const local = new Storage(); return { local, store: new SaveStore({ local, session: new Storage() }) }; }

test('a kill resumes the exact durable pose once through a fresh save-store reader', () => {
  const f = fixture(); expect(saveCrashPosition('coast', pose, f.store, 13_000)).toBe(true);
  const next = new SaveStore({ local: f.local, session: new Storage() });
  expect(consumeCrashResume(end, available, next)).toEqual({ slug: 'coast', pose });
  expect(consumeCrashResume(end, available, next)).toBeNull();
});

test.each(['intentional', 'fresh'] as const)('a %s end never spends a saved crash location', kind => {
  const f = fixture(); saveCrashPosition('coast', pose, f.store, 10_000);
  expect(consumeCrashResume({ ...end, kind }, available, f.store)).toBeNull();
  expect(consumeCrashResume(end, available, f.store)?.pose).toEqual(pose);
});

test('a removed world, different saved world, grid, or future pose cannot auto-enter', () => {
  const f = fixture(); saveCrashPosition('coast', pose, f.store, 10_000);
  expect(consumeCrashResume(end, [], f.store)).toBeNull();
  expect(consumeCrashResume({ ...end, slug: 'forest' }, available, f.store)).toBeNull();
  expect(consumeCrashResume({ ...end, mode: 'grid' }, available, f.store)).toBeNull();
  expect(consumeCrashResume({ ...end, bootedAt: 9999 }, available, f.store)).toBeNull();
});

test('failed durable consumption refuses automatic entry without losing the checkpoint', () => {
  const f = fixture(); saveCrashPosition('coast', pose, f.store, 10_000); f.local.blocked = true;
  expect(consumeCrashResume(end, available, f.store)).toBeNull();
});

test('the scoped checkpoint records current play every3s and stops with its owner', () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const f = fixture(), scope = new Scope('checkpoint'); let active = false;
  installCrashCheckpoint(scope, 'coast', () => active ? pose : null, f.store);
  expect(consumeCrashResume(end, available, f.store)).toBeNull();
  active = true; vi.advanceTimersByTime(3000); scope.dispose();
  expect(consumeCrashResume(end, available, f.store)?.pose).toEqual(pose);
  vi.advanceTimersByTime(3000);
  expect(consumeCrashResume(end, available, f.store)).toBeNull();
});
