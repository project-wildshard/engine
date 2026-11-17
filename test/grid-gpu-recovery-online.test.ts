// SENTRY-TRIAGE S13 (WILDSHARD-GAME-8H, opus-sentry 2026-11-17): a GPU-process restart on an online page went to the title.
// GpuRecovery asks the grid session to prepare a recovery before it reloads; on a wire, `bindWire` suppresses the page's own
// checkpoints (the server's saves are the session's), so `prepareRecovery` refused and the reload went to `/` without
// `?glreload`. Proved on staging v0.1.34 by scripts/gpu-recovery-proof.mjs: desktop Chromium on Driftwood landed on the title.
// On a wire a recovery needs only where this page stands; offline the region checkpoint must still land first.
import { installCatalogueFixture } from './fixtures/bootSetup';
import { expect, test } from 'vitest';
import { LiveGridSession, type LiveGridWire } from '../src/client/game/grid/liveSession';
import { Scope } from '../src/shared/engine/app/scope';
import { SaveStore } from '../src/shared/engine/saves/store';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { gridRecovery } from '../src/shared/game/grid/recovery';

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
