// SENTRY-TRIAGE S13 (WILDSHARD-GAME-8H, opus-sentry 2026-11-17): a GPU-process restart on an online page went to the title.
// GpuRecovery asks the grid session to prepare a recovery before it reloads; on a wire, `bindWire` suppresses the page's own
// checkpoints (the server's saves are the session's), so `prepareRecovery` refused and the reload went to `/` without
// `?glreload`. Proved on staging v0.1.34 by src/scripts/gpu-recovery-proof.mjs: desktop Chromium on Driftwood landed on the title.
// On a wire a recovery needs only where this page stands; offline the region checkpoint must still land first.
import { installCatalogueFixture } from './fixtures/bootSetup';
import { expect, test, vi } from 'vitest';
import { LiveGridSession, type LiveGridWire } from '../src/client/game/grid/liveSession';
import { Scope } from '../src/shared/engine/app/scope';
import { SaveStore } from '../src/shared/engine/saves/store';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { gridRecovery } from '../src/shared/game/grid/recovery';
import { resetNewGame } from '../src/shared/game/newGame';

await installCatalogueFixture();

class Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
}
const assembly = new GridAssembly({ developer: true, devserver: false });
const home = assembly.at(0, 0);
if (home === undefined) throw new Error('Missing actual grid home');

/** The session's own recovery methods over the page it would hold: the player on the road beside home, no region entered. */
function session(opts: { wired: boolean; checkpoint: boolean }): { owner: LiveGridSession; store: SaveStore } {
  const store = new SaveStore({ local: new Storage(), session: new Storage() });
  const value: unknown = Object.create(LiveGridSession.prototype);
  if (!(value instanceof LiveGridSession) || home === undefined) throw new Error('Missing live session prototype');
  const road = { x: home.origin.x + assembly.pitch / 2 + 3.6, z: home.origin.z };
  Reflect.set(value, 'ports', { scope: new Scope('s13.session'), assembly, home });
  Reflect.set(value, 'page', { saves: store, traveller: { yaw: 0 } });
  Reflect.set(value, 'autosave', null);
  Reflect.set(value, 'checkpointsSuppressed', false);
  Reflect.set(value, 'wire', null);
  Reflect.set(value, 'road', { lastRoad: () => null });
  Reflect.set(value, 'live', { current: () => null, worldFeet: () => ({ x: road.x, y: 0, z: road.z }), followServer: () => undefined });
  Reflect.set(value, 'checkpointHome', () => opts.checkpoint);
  if (opts.wired) value.bindWire({} as LiveGridWire); // as the online host does on connect
  return { owner: value, store };
}

test('an online page prepares a GPU recovery from where it stands, so the reload keeps the player in the world', () => {
  const { owner, store } = session({ wired: true, checkpoint: false });
  expect(owner.prepareRecovery('gpu')).toBe(true);
  expect(gridRecovery(store).consume(assembly)).toMatchObject({ kind: 'resume', record: { instance: home?.instance, reason: 'gpu' } });
});

test('offline, a recovery still needs its checkpoint to land first', () => {
  expect(session({ wired: false, checkpoint: false }).owner.prepareRecovery('gpu')).toBe(false);
  const { owner, store } = session({ wired: false, checkpoint: true });
  expect(owner.prepareRecovery('gpu')).toBe(true);
  expect(gridRecovery(store).consume(assembly)).toMatchObject({ kind: 'resume', record: { reason: 'gpu' } });
});

// STAGING-BUGBASH SB41 (opus-closeout1, staging v0.1.36, SENTRY-TRIAGE S22): the S13 reload kept the world but put the player
// on the road at (285,0), not on Driftwood's pier at (1,-194), 2 of 2. On a wire the server decides crossings, so the page can
// stand in its home with no entered region (`current()` null); the place was saved as `road` and the resume took the home's
// road lane. Where the feet stand inside a cell, that cell-local place is what the reload resumes.
test('a GPU recovery from the pier, with no region entered, resumes on the pier, not the road', () => {
  const { owner, store } = session({ wired: true, checkpoint: false });
  const pier = { x: (home?.origin.x ?? 0) + 1, y: 2.02, z: (home?.origin.z ?? 0) - 194 };
  Reflect.set(owner, 'live', { current: () => null, worldFeet: () => pier, followServer: () => undefined });
  expect(owner.prepareRecovery('gpu')).toBe(true);
  expect(gridRecovery(store).consume(assembly)).toMatchObject({ kind: 'resume', record: { instance: home?.instance,
    saved: { instance: home?.instance, location: { kind: 'cell', x: 1, y: 2.02, z: -194 } } } });
});

test('on the road between cells the recovery still resumes on the road', () => {
  const { owner, store } = session({ wired: true, checkpoint: false });
  expect(owner.prepareRecovery('gpu')).toBe(true);
  expect(gridRecovery(store).consume(assembly)).toMatchObject({ kind: 'resume', record: { saved: { location: { kind: 'road' } } } });
});

// SB41 again (buddy-engine, staging v0.1.40 20de8e5d): the record named the pier, but the online worker's pagehide save
// (clientWorker `save` → `grid.saveLocation()`) wrote the same place 322 ms later with a newer `at`. `validSaved` holds the
// record to the instance's exact saved place, so the newer stamp made it stale and the reload took the safe road at (285,0).
test('a location save after the recovery is prepared keeps the prepared place, so the reload still resumes on the pier', () => {
  vi.useFakeTimers({ now: 1_794_981_215_528 });
  try {
    const { owner, store } = session({ wired: true, checkpoint: false });
    const pier = { x: (home?.origin.x ?? 0) + 1, y: 2.02, z: (home?.origin.z ?? 0) - 194 };
    Reflect.set(owner, 'live', { current: () => null, worldFeet: () => pier, followServer: () => undefined });
    expect(owner.prepareRecovery('gpu')).toBe(true);
    vi.advanceTimersByTime(322);
    expect(owner.saveLocation()).toBe(false);
    expect(owner.serverPlace(home?.instance ?? '', { x: 1, y: 2.02, z: -194, yaw: 0 })).toBe(false);
    expect(gridRecovery(store).consume(assembly)).toMatchObject({ kind: 'resume', record: { saved: { location: { kind: 'cell', x: 1, z: -194 } } } });
  } finally { vi.useRealTimers(); }
});

// meta QA-FEEDBACK-2026-11-20-mini row 5 (mini-dw-fix, IPHONE13-DRIFTWOOD DW9): New Game on any grid cell said "Could not start a
// new game: your save is unchanged." Its recovery asked for a checkpoint, which `bindWire` suppresses on a wire, so it always
// threw. As a GPU recovery does, a wired page saves only where it stands; offline the checkpoint must still land first.
test('an online page prepares New Game from where it stands, and the reset reloads onto the road', () => {
  if (home === undefined) throw new Error('Missing actual grid home');
  const { owner, store } = session({ wired: true, checkpoint: false }), target = { id: home.instance, shard: home.slug };
  const commit = owner.prepareNewGameRecovery(target);
  expect(resetNewGame(store, target).applied).toBe(true); // the page's copy, as the sheet's NEW GAME resets it
  commit();
  expect(gridRecovery(store).consume(assembly)).toMatchObject({ kind: 'resume', record: { instance: home.instance, reason: 'new-game' } });
});

test('offline, New Game still needs its checkpoint to land first', () => {
  if (home === undefined) throw new Error('Missing actual grid home');
  expect(() => session({ wired: false, checkpoint: false }).owner.prepareNewGameRecovery({ id: home.instance, shard: home.slug })).toThrow(/checkpoint/u);
});
