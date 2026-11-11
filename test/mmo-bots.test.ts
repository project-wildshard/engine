// MMO-PLAN MP0.4: the bots' one hard rule (J205): loopback or the staging socket, never production. The bots themselves run
// only from scripts/mmo-bots.mjs against a replica or staging; this checks the guards they carry without opening a socket.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the scripts as text.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the driver's argument check only.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const entry = readFileSync('test/fixtures/dedicated/mmoBotsEntry.ts', 'utf8'), driver = readFileSync('scripts/mmo-bots.mjs', 'utf8');

test('the bots accept loopback and the staging socket only', () => {
  const guard = /const STAGING = '([^']+)'/u.exec(entry)?.[1];
  expect(guard).toBe('wss://wildshard.tailb41b20.ts.net:8443');
  expect(entry).toContain("assert.ok(loopback || parsed.origin === STAGING");
  // The URL check comes before any bot is made.
  expect(entry.indexOf('assert.ok(loopback')).toBeLessThan(entry.indexOf('new RoomBot('));
  // Production's Funnel port (443, no port in the URL), the future address, and the human release file appear nowhere.
  for (const text of [entry, driver]) {
    expect(text).not.toMatch(/wss:\/\/wildshard\.tailb41b20\.ts\.net(?!:8443)/u);
    expect(text).not.toContain('rooms.wildshard.io');
    expect(text).not.toContain('releases/production.json');
  }
});

test('the driver has two modes, neither of them production, and refuses anything else before the network', () => {
  for (const mode of ['production', 'prod', '']) {
    const run = spawnSync(process.execPath, ['scripts/mmo-bots.mjs', mode], { encoding: 'utf8', timeout: 10_000 });
    expect(run.status, mode).toBe(2);
    expect(run.stderr).toContain('usage: mmo-bots.mjs replica|staging');
  }
  expect(driver).toContain("if (mode !== 'replica' && mode !== 'staging')");
});

test('forwarded addresses belong to a loopback replica alone; staging gets the one Mac address and the 4-socket door limit', () => {
  expect(entry).toContain("assert.ok(addresses === 'own' || (addresses === 'forwarded' && loopback)");
  expect(entry).toContain("assert.ok(addresses === 'forwarded' || bots <= 4");
  expect(driver).toContain("mode === 'replica' ? 'forwarded' : 'own'");
  expect(driver).toMatch(/^const PER_ADDRESS = 4;$/mu);
  expect(readFileSync('src/server/host/dedicated/world.ts', 'utf8')).toMatch(/const SOCKETS_PER_IP = 4,/u);
});

test('staging keeps seats for people and checks its build before a hello', () => {
  expect(driver).toMatch(/STAGING_SEATS = 16, STAGING_HEADROOM = 4/u);
  const seats = driver.indexOf('bots leave'), bundle = driver.indexOf("spawn(process.execPath, [join(out, 'mmoBots.mjs')");
  expect(seats).toBeGreaterThan(0); expect(seats).toBeLessThan(bundle);
  expect(driver).toContain('Staging serves ${before.build}, and its release names ${release.engineBuild}');
});

test('the replica sends nothing off the Mac and runs on loopback with production shape', () => {
  expect(driver).toContain("TELEMETRY_URL: '', ERRORS_URL: '', SENTRY_DSN: ''");
  expect(driver).toContain("HOST: '127.0.0.1'");
  expect(driver).toMatch(/seats: \{ type: 'string', default: '32' \}, workers: \{ type: 'string', default: '4' \}/u);
  expect(driver).toContain("RELEASE_CHANNEL: 'production'");
  expect(driver).toContain('The release bundle differs from its SHA-256');
});

test('every bot leaves with the leave flag, so no held body keeps a staging seat', () => {
  expect(entry).toContain("walker.bot.transport.control('ready', new Uint8Array([LEAVE_FLAG]).buffer)");
  expect(readFileSync('src/server/host/dedicated/socketPump.ts', 'utf8')).toContain('export const LEAVE_FLAG = 1;');
  expect(entry).toContain('const LEAVE_FLAG = 1;');
});
