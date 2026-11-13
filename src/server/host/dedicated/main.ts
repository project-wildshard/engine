// Portable Math before anything, as every server entry starts (E7.2).
// oxlint-disable-next-line import/no-unassigned-import -- Its whole job is to run first.
import '@wildshard/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- The pull is its own program, so it can run with no bundle on disk.
import { spawn } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { once } from 'node:events';
// oxlint-disable-next-line import/no-nodejs-modules -- The server's port.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Rapier's wasm sits beside the bundle.
import { readFile } from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- A row of the table is a worker thread (J182).
import { Worker } from 'node:worker_threads';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import type { WorkerNews } from './cellProtocol';
import type { CellWorkerData } from './cellWorker';
import { readPackProduct, type PackReads } from './packReader';
import { openPlayerSaves, memoryPlayerSaves } from './playerSaves';
import type { ReleaseFile } from '../../../shared/host/releaseRows';
import { fetchReleaseFile, servingRelease, ReleaseWatch } from './releaseFile';
import { savesUrl } from './saves/pgDatabase';
import { ServerReports } from './serverReports';
import { sendSentryTest, serverSentry } from './serverSentry';
import {PlaytestFile} from './playtest';
import { World, type PlayerSaves, type WorkerLink } from './world';
import { cloudflareTurn } from './voiceRelay';
import { worldSettings } from './workerTable';
import { doorTrust } from './doorTrust';
import { WHOLE_GRID, cellShard, placeCell, placedCells, worldCells } from './gridCells';
import { PlacementWatch, fetchPlacementFile } from './placementFile';

declare const __BUILD_ID__: string;
/** scripts/build-server.mjs: package.json's version, the Sentry release (S8). */
declare const __ENGINE_VERSION__: string | undefined;
const need = (name: string): string => { const value = process.env[name]; if (value === undefined || value === '') throw new Error(`The server needs ${name}`); return value; };
const log = (line: Record<string, unknown>): void => { console.info(JSON.stringify(line)); };
const engineVersion = typeof __ENGINE_VERSION__ === 'string' ? __ENGINE_VERSION__ : undefined;
// S8: `node main.mjs --sentry-test` sends one deliberate event with the unit's env, then exits. It refuses any channel but staging.
if (process.argv.includes('--sentry-test')) process.exit(await sendSentryTest({ env: process.env, build: process.env['WILDSHARD_BUILD'] ?? __BUILD_ID__, version: engineVersion, log }));
const build = process.env['WILDSHARD_BUILD'] ?? __BUILD_ID__, origin = need('PACK_ORIGIN'), cache = process.env['PACK_CACHE'] ?? '/var/lib/wildshard/packs';
const port = Number(process.env['PORT'] ?? 8790), host = process.env['HOST'] ?? '127.0.0.1', started = Date.now();
const releaseAt = need('RELEASE_URL'), releaseKey = need('RELEASE_PUBLIC_KEY'), channel = process.env['RELEASE_CHANNEL'] ?? 'production';
const readRelease = async (): Promise<ReleaseFile> => {
  const file = await fetchReleaseFile(releaseAt, releaseKey);
  if (file.channel !== channel) throw new Error(`Release channel ${file.channel} does not match ${channel}`);
  return file;
};
/** The newest file. If it names a bundle that never landed, or R2 is away, this bundle's own: the signed file the pull kept beside it. A bad hash must leave the old bundle running (E7.2c). */
async function installedRelease(): Promise<ReleaseFile> {
  const newest = await readRelease().catch(() => null);
  const kept = await fetchReleaseFile(new URL('release.json', import.meta.url).href, releaseKey).catch(() => null);
  const installed = process.env['PULL_SCRIPT'] !== undefined || await readFile(new URL('.bundle-sha256', import.meta.url)).then(() => true, () => false);
  const selected = servingRelease(build, channel, newest, kept, installed);
  log({ at: 'release.installed', serial: selected.serial, newest: newest?.serial });
  return selected;
}
const release = await installedRelease();
// C5, C11, GO3: the cells, by grid instance, fixed at startup; a player with no save lands in the first. `grid` opens every grid cell
// the release names, home first. A cell runs its shard's pack, and the release must name that shard.
const listed = process.env['WORLD_CELLS'] ?? 'driftwood-isle', cells = worldCells(listed, release.shards.map(shard => shard.slug)), shards = [...new Set(cells.map(cellShard))];
const hold = process.env['HOLD_MS'], grace = process.env['GRACE_MS'], poll = process.env['RELEASE_POLL_MS'], recordEvery = process.env['RECORD_MS'];
// An env file's blank row means unset.
const setting = (name: string): string | undefined => { const value = process.env[name]; return value === '' ? undefined : value; };
const sentry = serverSentry({ dsn: setting('SENTRY_DSN'), version: engineVersion, build, channel: release.channel });
const reports = new ServerReports({ build, channel: release.channel, telemetryUrl: setting('TELEMETRY_URL'), errorsUrl: setting('ERRORS_URL'), tag: setting('RECORD_TAG'), log, sentry, ...(recordEvery === undefined ? {} : { everyMs: Number(recordEvery) }) });
const url = process.env['DATABASE_URL'] ?? savesUrl(release.channel), saves: PlayerSaves = url === 'memory:' ? memoryPlayerSaves() : await openPlayerSaves(url, new URL('migrations/', import.meta.url), release.saveEpoch, log, issue => { reports.contract(issue); });
const recordTag=setting('RECORD_TAG');
const turnKey = setting('WILDSHARD_TURN_KEY_ID'), turnToken = setting('WILDSHARD_TURN_KEY_TOKEN');
// GC15: `WORLD_CROSSING=worker` opens each worker's road and lets a seat walk between the cells it hosts. Off unless set (GRID-CROSSING).
const crossingSetting = setting('WORLD_CROSSING');
if (crossingSetting !== undefined && crossingSetting !== 'worker') throw new Error(`WORLD_CROSSING=${crossingSetting}: only worker, or unset`);
const crossing = crossingSetting === 'worker';
// SA33: where the API's signed placement file is, and its own key's public half. Both or neither; only a whole-grid world grows.
const placementAt = setting('PLACEMENT_URL'), placementKey = setting('PLACEMENT_PUBLIC_KEY');
if ((placementAt === undefined) !== (placementKey === undefined)) throw new Error('PLACEMENT_URL and PLACEMENT_PUBLIC_KEY go together');
const playtest=process.env['PLAYTEST']==='1'?new PlaytestFile({directory:setting('PLAYTEST_DIR')??'/var/log/wildshard',build,log,...(recordTag===undefined?{}:{tag:recordTag})}):undefined;

/** One row of the table is one worker thread, started once (J182). */
function bootWorker(slugs: readonly string[]): WorkerLink {
  const data: CellWorkerData = { slugs, build, origin, cache, placed: placedCells(), ...(hold === undefined ? {} : { holdMs: Number(hold) }), ...(crossing ? { crossing } : {}),...(playtest===undefined?{}:{playtest:true}) };
  const worker = new Worker(new URL('cellWorker.mjs', import.meta.url), { workerData: data });
  let stopped = false;
  return { send: (order, transfer = []) => { worker.postMessage(order, transfer as never); },
    listen: (news, ended) => {
      worker.on('error', (error: Error) => { ended(error.message); });
      worker.on('exit', code => { if (!stopped) ended(`exit ${String(code)}`); });
      worker.on('message', (row: WorkerNews) => { news(row); });
    },
    stop: () => { stopped = true; void worker.terminate(); } };
}

/** How the process ends, once there is a world to save. */
let stop = (code: number): void => { void reports.settled().then(() => { process.exit(code); }); };
let ending = false;
/** One failure can arrive twice: a worker that fails at boot also rejects the wait for it. */
const failed = (error: unknown): void => { if (ending) return; ending = true; log({ at: 'server.crashed', error: String(error) }); reports.error(error); stop(1); };
process.on('uncaughtException', failed);
// VH10: which forwarded header the door believes, and which pages may open a socket. A word it doesn't know stops here.
const trust = doorTrust(process.env);
const world: World = await World.open({ build, cells, roads: crossing, ...worldSettings(release.channel, process.env), ...trust, secret: need('SEAT_SECRET'), saves, log, boot: bootWorker, ...(grace === undefined ? {} : { graceMs: Number(grace) }),
  // Q77: a worker that fails ends the process. systemd starts it again, clients redial, and saves stand at the last checkpoint.
  crashed: failed, reading: (index, row) => { reports.heard(index, row); },
  ...(playtest===undefined?{}:{playtest:row=>{playtest.append(row);}}),
  // J218: phones on 4G need TURN to reach each other's voice. Without the key, voice falls back to public STUN.
  ...(turnKey === undefined || turnToken === undefined ? {} : { voiceIce: cloudflareTurn(turnKey, turnToken) }),
  restart: () => { stop(0); } });
/** SA33's watch, once the door listens; `/health` names its serial. */
let placements: PlacementWatch | null = null;
const server = createServer((request, response) => {
  if (request.url !== '/health') { response.writeHead(404).end(); return; }
  // E7.5 prep: any page may read it (no player data), so the Connection doctor sees the build; `now` lets it read a phone's clock.
  response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }).end(JSON.stringify({ ...world.health(), serial: release.serial, ...(placements === null ? {} : { placements: placements.serial }), uptime: Math.round((Date.now() - started) / 1000), now: Date.now() }));
});
server.on('upgrade', (request, socket, head) => { world.upgrade(request, socket, head); });
stop = (code): void => { void (async (): Promise<void> => {
  const written = await world.drain().catch(() => false);
  log({ at: 'server.drained', written, saves: saves.stats?.() });
  server.close();
  await reports.settled();
  const recorded=await playtest?.close();if(recorded===false)log({at:'playtest.incomplete'});
  process.exit(written ? code : 1);
})(); };
await new Promise<void>(resolve => { server.listen(port, host, resolve); });
log({ at: 'server.listening', host, port, build, cells, crossing, trustProxy: trust.trustProxy, origins: trust.allowedOrigins ?? '*', serial: release.serial, epoch: release.saveEpoch, node: process.version });
// The door keeps Rapier only to read a new build's packs, so this costs no worker a tick.
const reads: PackReads = { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 }, wasm = new URL('rapier.wasm', import.meta.url), rapier = async (): Promise<Awaited<ReturnType<typeof loadRapier>>> => loadRapier(await readFile(wasm));
// The bundle and its packs reach disk before anyone hears a countdown, so the move costs a restart and no download. A bad hash stops here, with
// everyone still playing, and the next look tries again. `ExecStartPre` moves `current` (E7.2c, C21).
const pullScript = process.env['PULL_SCRIPT'];
async function pullBundle(script: string): Promise<void> {
  const [code] = await once(spawn(process.execPath, [script, '--fetch'], { stdio: ['ignore', 'inherit', 'inherit'] }), 'exit') as [number | null];
  if (code !== 0) throw new Error('The pull refused this release');
}
const watch = new ReleaseWatch({ read: readRelease, serving: release, cells: shards, ...(poll === undefined ? {} : { everyMs: Number(poll) }), failed: error => { log({ at: 'release.failed', error: String(error) }); },
  changed: async next => {
    if (pullScript !== undefined) await pullBundle(pullScript);
    for (const slug of shards) await readPackProduct(slug, next.engineBuild, await rapier(), { origin, cache }, reads);
    world.beginGrace(next.engineBuild);
  } });
// SA33: a cell the API placed opens on this running server within a look, on a worker of its own, with no grace and no restart. Its shard's
// server pack must already be in this build's book: one that isn't is refused here, before any worker boots, and asked for again next look.
placements = placementAt === undefined || placementKey === undefined || listed.trim() !== WHOLE_GRID ? null : new PlacementWatch({
  read: () => fetchPlacementFile(placementAt, placementKey), channel: release.channel, ...(poll === undefined ? {} : { everyMs: Number(poll) }),
  failed: error => { log({ at: 'placement.failed', error: String(error) }); },
  open: async rows => {
    const ready: string[] = [];
    for (const row of rows) {
      // SA34a: the pack first, so the door's placed list (and so every worker's frame numbers) holds only cells it opens.
      try { await readPackProduct(row.slug, build, await rapier(), { origin, cache }, reads); placeCell(row); ready.push(row.instance); }
      catch (error) { log({ at: 'placement.refused', instance: row.instance, slug: row.slug, error: String(error) }); }
    }
    return ready.length === 0 ? [] : world.openCells(ready);
  } });
void placements?.look();
process.once('SIGTERM', () => { watch.dispose(); placements?.dispose(); stop(0); });
