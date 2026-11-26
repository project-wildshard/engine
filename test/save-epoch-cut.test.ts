// WIRE-STABILITY WR8b (opus-wr8, review meta docs/plans/wire-stability/WR8-REVIEW.md): the epoch-2 cut, J197/J210's one
// planned wipe. The shipped identity moves to epoch 2 over epoch 1; a real 1 -> 2 boot keeps the device identity, the
// sign-in session, settings and device preferences, and resets progress; every client older than the cut is forced over
// once (J383) so no device plays epoch-1 progress against an epoch-2 server; and no page code reads another epoch.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import * as v from 'valibot';
import { installAppIdentity } from '../src/shared/engine/app/identity';
import { WILDSHARD_IDENTITY } from '../src/client/game/identity';
import { SaveStore } from '../src/shared/engine/saves/store';
import { deviceIdentity } from '../src/shared/engine/net/identity';
import { clientFloor } from '../src/scripts/app-build/clientFloor';
import { olderClient } from '../src/client/engine/boot/forceUpdate';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { writeSave } from '../src/server/host/dedicated/saves/saveStore';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { openPglite } from './fixtures/pgliteDatabase';
import { SHARD, open, enter, earn, quit } from './fixtures/dedicatedDoc';
import { MemoryStorage } from './setup';

const EPOCH = 2, CUT = '0.1.36';
const base = 'wildshard.save.v2.', previous = 'wildshard.save.v2@1.', current = 'wildshard.save.v2@2.';
afterEach(() => installAppIdentity(WILDSHARD_IDENTITY));

test('the shipped identity is epoch 2 over epoch 1, with the device identity namespace unchanged', () => {
  expect((JSON.parse(readFileSync('save-epoch.json', 'utf8')) as { saveEpoch: number }).saveEpoch).toBe(EPOCH);
  expect(WILDSHARD_IDENTITY).toMatchObject({ saveEpoch: EPOCH, savePrefix: current, previousSavePrefix: previous, identityPrefix: base });
});

test('a real epoch 1 -> 2 boot keeps identity, session, settings and device preferences, and resets progress', () => {
  const local = new MemoryStorage(), keys = (data: Record<string, unknown>) => JSON.stringify({ keys: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { v: 1, data: value }])) });
  local.setItem(`${previous}global`, keys({ settings: { music: false }, gfx: { quality: 'low' }, hints: ['done'] }));
  local.setItem(`${previous}device`, keys({ ktx2set: { pine: true }, voice: { wanted: true, seen: true }, voiceSettings: { volume: 0.4 },
    titlePrefetch: 'nalati-grasslands', 'telemetry.install': 'install-1', 'grid.last-played': { slug: 'ember-forge' }, 'grid.server-placed': true }));
  local.setItem(`${previous}driftwood-isle`, keys({ purse: 99 }));
  local.setItem('wildshard.player.session', '{"account":"a1"}');
  const player = deviceIdentity(local, base).player;
  installAppIdentity(WILDSHARD_IDENTITY);
  const saves = new SaveStore({ local, session: new MemoryStorage() });
  const settings = saves.define({ key: 'settings', scope: 'global', version: 1, schema: v.object({ music: v.boolean() }), initial: () => ({ music: true }) });
  expect(settings.read()).toEqual({ music: false });
  const device = local.getItem(`${current}device`) ?? '';
  for (const kept of ['ktx2set', 'voice', 'voiceSettings', 'titlePrefetch', 'telemetry.install']) expect(device).toContain(`"${kept}"`);
  for (const reset of ['grid.last-played', 'grid.server-placed']) expect(device).not.toContain(`"${reset}"`);
  expect(local.getItem(`${current}global`)).not.toContain('hints');
  expect(saves.exportAll()).not.toContain('purse');
  expect(deviceIdentity(local, current).player).toBe(player);
  expect(local.getItem('wildshard.player.session')).toBe('{"account":"a1"}');
  // Epoch 1 stays on the device, orphaned, never deleted: a restore stays possible (review section 4).
  expect(local.getItem(`${previous}driftwood-isle`)).toContain('99');
  expect(JSON.parse(saves.exportAll())).toHaveProperty('saveEpoch', EPOCH);
});

test('the epoch cut enforces its floor until the next scheduled client floor', () => {
  for (const version of ['0.1.31', '0.1.34', '0.1.35']) expect(olderClient(version, clientFloor(CUT))).toBe(true);
  for (const version of [CUT, '0.1.40', '0.1.72']) {
    expect(clientFloor(version)).toBe(CUT);
    expect(olderClient(version, clientFloor(version))).toBe(false);
  }
  // Main still names the release before the cut while the cut's release branch ships: it clamps to itself.
  expect(clientFloor('0.1.35')).toBe('0.1.35');
});

test('an epoch-2 server seats an epoch-1 player fresh and leaves the epoch-1 row untouched', { timeout: 20_000 }, async () => {
  const room = await open('wr8-epoch'), phone = enter(room, 'device:wr8'); earn(room, phone.device, 'paid');
  const saved = quit(phone);
  const db = await openPglite(); await migrate(db);
  const rows = async (): Promise<unknown> => (await db.query('select epoch, seq, doc from player_save order by epoch')).rows;
  try {
    expect(await writeSave(db, 1, saved)).toBe(true);
    const before = await rows();
    // The dedicated host opens its saves at the installed release's epoch (main.ts, `release.saveEpoch`).
    const one = playerSavesOver(db, 1, () => undefined), two = playerSavesOver(db, EPOCH, () => undefined);
    try {
      expect((await one.read('device:wr8', SHARD)).doc).not.toBeNull();
      expect(await two.read('device:wr8', SHARD)).toMatchObject({ doc: null, seq: 0 });
      expect(await two.where('device:wr8')).toBeNull();
      expect(await rows()).toEqual(before);
    } finally { for (const saves of [one, two]) { saves.queue.dispose(); saves.reports.dispose(); } }
  } finally { await db.close(); }
});

/** Every file under `dir` with one of `extensions`. */
function files(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, extensions) : extensions.some(ext => name.endsWith(ext)) ? [path] : [];
  });
}
test('page code, the page shell and the proof scripts name only the current epoch', () => {
  const stale = [...files('src', ['.ts', '.js', '.mjs']), 'index.html']
    .filter(path => path !== join('src', 'client', 'game', 'identity.ts'))
    .flatMap(path => [...readFileSync(path, 'utf8').matchAll(/save\.v2@(\d+)\.|wildshard-saves@(\d+)/gu)]
      // force-update-proof.mjs plants a database from far in the future on purpose.
      .filter(match => Number(match[1] ?? match[2]) !== EPOCH && Number(match[2]) !== 12345).map(match => `${path}: ${match[0]}`));
  expect(stale).toEqual([]);
});
