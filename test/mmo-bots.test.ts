// MMO-PLAN MP0.4: the bots' one hard rule (J205): loopback or the staging socket, never production. The bots themselves run
// only from scripts/mmo-bots.mjs against a replica or staging; this checks the guards they carry without opening a socket.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the scripts as text.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the driver's argument check only.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { botTarget, SOCKETS_PER_ADDRESS, STAGING_SOCKET } from './fixtures/dedicated/mmoBotsGuard';

const entry = readFileSync('test/fixtures/dedicated/mmoBotsEntry.ts', 'utf8'), driver = readFileSync('scripts/mmo-bots.mjs', 'utf8');

test('the bots accept loopback and the staging socket only', () => {
  expect(STAGING_SOCKET).toBe('wss://wildshard.tailb41b20.ts.net:8443');
  for (const url of ['ws://127.0.0.1:18796/', 'ws://localhost:18796/', 'ws://[::1]:18796/', 'wss://wildshard.tailb41b20.ts.net:8443', 'wss://wildshard.tailb41b20.ts.net:8443/']) {
    expect(() => botTarget(url, 'own', 2), url).not.toThrow();
  }
  // Production's Funnel (443, with or without the port), the future address, other paths and hosts, plain ws to the tailnet.
  for (const url of ['wss://wildshard.tailb41b20.ts.net', 'wss://wildshard.tailb41b20.ts.net:443/', 'wss://rooms.wildshard.io/', 'ws://wildshard.tailb41b20.ts.net:8443/',
    'wss://wildshard.tailb41b20.ts.net:8443/other', 'wss://wildshard.tailb41b20.ts.net:8443/?x=1', 'ws://10.0.0.5:18796/', 'wss://127.0.0.1:18796/', 'ws://127.0.0.1.example.com/']) {
    expect(() => botTarget(url, 'own', 1), url).toThrow(/J205/u);
  }
  // The guard runs before any bot is made, and the driver copies it beside the entry it builds.
  expect(entry.indexOf('botTarget(url, addresses, bots)')).toBeGreaterThan(0);
  expect(entry.indexOf('botTarget(url, addresses, bots)')).toBeLessThan(entry.indexOf('new RoomBot('));
  expect(driver).toContain("['mmoBotsEntry.ts', 'mmoBotsGuard.ts']");
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
  expect(() => botTarget('wss://wildshard.tailb41b20.ts.net:8443/', 'forwarded', 2)).toThrow(/loopback replica only/u);
  expect(() => botTarget('ws://127.0.0.1:18796/', 'forwarded', 32)).not.toThrow();
  expect(() => botTarget('ws://127.0.0.1:18796/', 'own', SOCKETS_PER_ADDRESS + 1)).toThrow(/at most 4 sockets/u);
  expect(() => botTarget('wss://wildshard.tailb41b20.ts.net:8443/', 'own', SOCKETS_PER_ADDRESS + 1)).toThrow(/at most 4 sockets/u);
  expect(() => botTarget('ws://127.0.0.1:18796/', 'spoof', 2)).toThrow(/Unknown address mode/u);
  expect(() => botTarget('ws://127.0.0.1:18796/', 'forwarded', 65)).toThrow(/Between 1 and 64/u);
  expect(SOCKETS_PER_ADDRESS).toBe(4);
  expect(driver).toContain("mode === 'replica' ? 'forwarded' : 'own'");
  expect(driver).toMatch(/^const PER_ADDRESS = 4;$/mu);
  expect(readFileSync('src/server/host/dedicated/world.ts', 'utf8')).toMatch(/const SOCKETS_PER_IP = 4,/u);
});

test('staging keeps seats for people and checks its build and seats again just before a hello', () => {
  expect(driver).toMatch(/STAGING_SEATS = 16, STAGING_HEADROOM = 4/u);
  const seats = driver.indexOf('bots leave'), recheck = driver.indexOf("await stagingRoom('before the first hello')"), bundle = driver.indexOf("spawn(process.execPath, [join(out, 'mmoBots.mjs')");
  expect(seats).toBeGreaterThan(0); expect(seats).toBeLessThan(bundle);
  expect(recheck).toBeGreaterThan(driver.indexOf("execFileSync(process.execPath, ['scripts/build-server.mjs'")); expect(recheck).toBeLessThan(bundle);
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

test('the replica is stopped on every way out: the end, an error, or a signal', () => {
  expect(driver).toMatch(/\} finally \{\n {2}await stopRoom\(\);/u);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) expect(driver).toContain(`'${signal}'`);
  expect(driver).toContain("process.once('exit', () => { room?.kill('SIGKILL'); });");
});
