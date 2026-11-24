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
import { readPackFolder, readPackHeader, readReleaseItems, type PackReads } from './packReader';
import { openPlayerSaves, memoryPlayerSaves } from './playerSaves';
import { guestExpiryDays, startGuestExpiry } from './saves/expiry';
import { accountRoutes } from './accountRoutes';
import { PLAYER_TICKET_PUBLIC_KEY } from './ticket';
import { Scope } from '@wildshard/engine/app/scope';
import type { ReleaseFile } from '../../../shared/host/releaseRows';
import { fetchReleaseFile, readPulledReleaseCells, servingRelease, ReleaseWatch } from './releaseFile';
import { savesUrl } from './saves/pgDatabase';
import { within } from './saves/saveStore';
import { ZoneEntries, ZONE_ENTRY_MINUTE_MS } from './zoneEntries';
import { metricsCurrentRoute } from './metricsCurrentRoute';
import { readZoneUploads, zoneCatalogueUrl, zoneSelectRoute, zoneSelectTabs } from './zoneSelect';
import { zoneSelectPressRoute } from './zoneSelectPress';
import { ServerReports } from './serverReports';
import { RoomSessions } from './roomSessions';
import { RoomGameMetrics } from './roomGameMetrics';
import { roomMetricsDailyRoute } from './metricsDailyRoute';
import { ServerMetrics, metricsPort } from './serverMetrics';
import { sendSentryTest, serverSentry } from './serverSentry';
import {PlaytestFile} from './playtest';
import { World, type PlayerSaves, type WorkerLink } from './world';
import { cloudflareTurn } from './voiceRelay';
import { declaredCells, worldSettings, type DeclaredCells } from './workerTable';
import { doorTrust } from './doorTrust';
import { WHOLE_GRID, catalogueCell, cellShard, homeCell, keepPlacedCells, placeCell, placedCells, placementSlots, releasedWorldShards, worldCells } from './gridCells';
import { PlacementWatch, fetchPlacementFile, placementOpener } from './placementFile';
import {uploadActivator, uploadActivationReceiver} from './uploadActivation';
import { DEV_CONTROL_PATH, devRoute } from './devControl';
import { rawServerPlan } from '@wildshard/engine/game/shardfile/serverPlan';

declare const __BUILD_ID__: string;
/** scripts/build-server.mjs: true only for `--dev`, the local dev server (MEMORY-STRUCTURE STR4). */
declare const __DEVSERVER__: boolean;
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
const itemReads: PackReads = { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 };
const catalogue = await readReleaseItems(release.items, { origin, cache }, itemReads);
// C5, C11, GO3: the cells, by grid instance, fixed at startup; a player with no save lands in the first. `grid` opens every grid cell
// the release names, home first. A cell runs its shard's pack, and the release must name that shard.
const listed = process.env['WORLD_CELLS'] ?? homeCell(), cells = worldCells(listed, release.shards.map(shard => shard.slug));
const hold = process.env['HOLD_MS'], empty = process.env['EMPTY_MS'], grace = process.env['GRACE_MS'], poll = process.env['RELEASE_POLL_MS'], recordEvery = process.env['RECORD_MS'];
// An env file's blank row means unset.
const setting = (name: string): string | undefined => { const value = process.env[name]; return value === '' ? undefined : value; };
const sentry = serverSentry({ dsn: setting('SENTRY_DSN'), version: engineVersion, build, channel: release.channel });
const roomMetricsToken = setting('ROOM_METRICS_TOKEN');
const reports = new ServerReports({ build, channel: release.channel, telemetryUrl: setting('TELEMETRY_URL'), errorsUrl: setting('ERRORS_URL'), tag: setting('RECORD_TAG'), log, sentry, ...(roomMetricsToken === undefined ? {} : { roomMetricsToken }), ...(recordEvery === undefined ? {} : { everyMs: Number(recordEvery) }) });
const url = process.env['DATABASE_URL'] ?? savesUrl(release.channel), saves: PlayerSaves = url === 'memory:' ? memoryPlayerSaves() : await openPlayerSaves(url, new URL('migrations/', import.meta.url), release.saveEpoch, log, issue => { reports.contract(issue); });
const seatSecret = need('SEAT_SECRET');
const arrivals = saves.zoneEntries === undefined ? undefined : new ZoneEntries(saves.zoneEntries, release.channel, seatSecret, log);
const sessions = saves.metricSessions === undefined ? undefined
  : new RoomSessions(saves.metricSessions, release.channel, seatSecret, rows => { reports.sessions(rows); }, log);
const roomGame = saves.roomGame === undefined ? undefined
  : new RoomGameMetrics(saves.roomGame, release.channel, rows => { reports.game(rows); }, log);
if (roomGame !== undefined) sessions?.watchGame(roomGame);
const arrivalScope = new Scope('dedicated.zone-entries');
if (arrivals !== undefined) arrivalScope.interval(ZONE_ENTRY_MINUTE_MS, () => { void arrivals.flush(); });
if (sessions !== undefined) arrivalScope.interval(ZONE_ENTRY_MINUTE_MS, () => { void sessions.flush(); });
if (roomGame !== undefined) arrivalScope.interval(ZONE_ENTRY_MINUTE_MS, () => { void roomGame.flush(); });
const recordTag=setting('RECORD_TAG');
const turnKey = setting('WILDSHARD_TURN_KEY_ID'), turnToken = setting('WILDSHARD_TURN_KEY_TOKEN');
// J353: zone entry is the only implementation. Old box files may retain this row during rollout.
const legacyWorldCrossing = setting('WORLD_CROSSING');
if (legacyWorldCrossing !== undefined) log({ at: 'world.crossing.ignored', value: legacyWorldCrossing, reason: 'zone-entry' });
// An author's local build is one cell, with no grid pack or neighbouring shards.
const authorProduct = typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ ? setting('WILDSHARD_DEV_PRODUCT') : undefined;
if (authorProduct !== undefined && (host !== '127.0.0.1' || cells.length !== 1)) throw new Error('A dev product needs one cell on loopback');
const crossing = authorProduct === undefined;
// SA33: where the API's signed placement file is, and its own key's public half. Both or neither; only a whole-grid world grows.
const placementAt = setting('PLACEMENT_URL'), placementKey = setting('PLACEMENT_PUBLIC_KEY');
if ((placementAt === undefined) !== (placementKey === undefined)) throw new Error('PLACEMENT_URL and PLACEMENT_PUBLIC_KEY go together');
// SERVER-CELLS SC1: `/metrics` on 127.0.0.1:METRICS_PORT, unset off. Made before the world opens, so every cell's boot is counted.
const metricsAt = metricsPort(process.env), metrics = metricsAt === undefined ? undefined : new ServerMetrics(log, release.channel, { build, serial: release.serial });
const playtest=process.env['PLAYTEST']==='1'?new PlaytestFile({directory:setting('PLAYTEST_DIR')??'/var/log/wildshard',build,log,...(recordTag===undefined?{}:{tag:recordTag})}):undefined;

/** One row of the table is one worker thread, started once (J182). */
function bootWorker(slugs: readonly string[]): WorkerLink {
  const data: CellWorkerData = { slugs, build, origin, cache, catalogue, placed: placedCells(), ...(hold === undefined ? {} : { holdMs: Number(hold) }), ...(empty === undefined ? {} : { emptyMs: Number(empty) }), crossing, ...(metrics === undefined ? {} : { metrics: true }), ...(sessions === undefined ? {} : { metricEvents: true }),...(playtest===undefined?{}:{playtest:true}),
    ...(authorProduct === undefined ? {} : { authorProduct }) };
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
// MMO-PLAN MP2.2c: a proof's or a dev box's own ticket key, SPKI DER hex; unset, the pinned one (`ticket.ts`). The box's settings
// are root's (`wildshard-config`), and the boot log says when the pin is overridden.
const ticketKey = setting('PLAYER_TICKET_PUBLIC_KEY');
if (ticketKey !== undefined) log({ at: 'tickets.key', pinned: false, key: ticketKey.slice(-16) });
// ONE-FORMAT OF31h2: each cell's own shard file may say what it costs awake and whose worker it shares; one that says nothing keeps
// the measured table's row. An author's local product has one cell and no book to read.
const declared: DeclaredCells = authorProduct === undefined ? await declaredCells(cells, cell => readPackHeader(cellShard(cell), build, { origin, cache }, itemReads)) : new Map();
if (declared.size > 0) log({ at: 'world.declared', cells: Object.fromEntries(declared) });
const world: World = await World.open({ build, cells, declared, roads: crossing, ...worldSettings(release.channel, process.env), ...trust, ...(ticketKey === undefined ? {} : { ticketKey }), secret: seatSecret, saves, log, boot: bootWorker, ...(grace === undefined ? {} : { graceMs: Number(grace) }),
  ...(arrivals === undefined ? {} : { entered: (seat, slug, actor) => { if (arrivals.entered(seat, slug, actor)) metrics?.entered(slug, actor.actor); } }),
  ...(sessions === undefined ? {} : { sessions }),
  // Q77: a worker that fails ends the process. systemd starts it again, clients redial, and saves stand at the last checkpoint.
  crashed: failed, reading: (index, row) => { reports.heard(index, row); metrics?.reading(index, row); }, ...(metrics === undefined ? {} : { link: metrics.link }),
  ...(metrics === undefined ? {} : { booted: (_index: number, _slug: string, ms: number) => { metrics.booted(ms); }, crossed: (ms: number, moved: boolean) => { metrics.crossed(ms, moved); } }),
  ...(playtest===undefined?{}:{playtest:row=>{playtest.append(row);}}),
  // J218: phones on 4G need TURN to reach each other's voice. Without the key, voice falls back to public STUN.
  ...(turnKey === undefined || turnToken === undefined ? {} : { voiceIce: cloudflareTurn(turnKey, turnToken) }),
  restart: () => { stop(0); } });
/** SA33's watch, once the door listens; `/health` names its serial. */
let placements: PlacementWatch | null = null;
let activationReceiver: ReturnType<typeof uploadActivationReceiver> | undefined;
// MMO-PLAN MP2.5a: a signed-in page's export and delete, with its join ticket as the proof. Memory saves have none.
const { exportAccount: exporting, deleteAccount: deleting } = saves;
const accounts = exporting === undefined || deleting === undefined ? undefined : accountRoutes({ ticketKey: ticketKey ?? PLAYER_TICKET_PUBLIC_KEY, allowedOrigins: trust.allowedOrigins, hold: seat => world.holdForDelete(seat), exportAccount: exporting, deleteAccount: deleting, deleted: account => { world.forgetAccount(account); }, log });
const catalogueAt = zoneCatalogueUrl(placementAt);
const zoneSelect = zoneSelectRoute({
  channel: release.channel, allowedOrigins: trust.allowedOrigins,
  world: () => ({ serial: release.serial, slugs: world.openShards(), featured: placements?.featured }),
  uploads: () => readZoneUploads(catalogueAt),
  totals: () => arrivals?.totals() ?? Promise.resolve([]),
  log,
});
const zoneSelectPress = zoneSelectPressRoute({
  ...trust, channel: release.channel,
  enterable: slug => world.openShards().includes(slug),
  press: (slug, actor) => { arrivals?.pressed(slug, actor); },
});
const dailyMetrics = saves.metricsDaily === undefined || release.channel === 'preview' ? undefined
  : roomMetricsDailyRoute({ channel: release.channel, read: saves.metricsDaily, log });
const metricsChannel = release.channel;
const currentMetrics = arrivals === undefined || metricsChannel === 'preview' ? undefined : metricsCurrentRoute({
  channel: metricsChannel, markers: () => world.markerReading(), live: () => world.livePlayers(), entries: days => arrivals.totals(days), log,
  selection: async entries => zoneSelectTabs(metricsChannel, { serial: release.serial, slugs: world.openShards(), featured: placements?.featured },
    await readZoneUploads(catalogueAt).catch(() => []), entries),
});
const server = createServer((request, response) => {
  if (currentMetrics?.(request, response) === true) return;
  if (dailyMetrics?.(request, response) === true) return;
  if (zoneSelect(request, response)) return;
  if (zoneSelectPress(request, response)) return;
  if (activationReceiver?.(request, response)) return;
  if (accounts?.(request, response) === true) return;
  // MEMORY-STRUCTURE STR4: a dev server's control channel (`build-server.mjs --dev`); the box's bundle folds this away
  if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ && request.url === DEV_CONTROL_PATH) { devRoute(request, response, (device, message) => world.dev(device, message), trust.allowedOrigins, () => world.devSeats()); return; }
  if (request.url !== '/health') { response.writeHead(404).end(); return; }
  // E7.5 prep: any page may read it (no player data), so the Connection doctor sees the build; `now` lets it read a phone's clock.
  response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }).end(JSON.stringify({ ...world.health(), serial: release.serial, ...(placements === null ? {} : { placements: placements.serial }), uptime: Math.round((Date.now() - started) / 1000), now: Date.now() }));
});
server.on('upgrade', (request, socket, head) => { world.upgrade(request, socket, head); });
let draining = false;
stop = (code): void => { if (draining) return; draining = true; void (async (): Promise<void> => {
  const written = await world.drain().catch(() => false);
  log({ at: 'server.drained', written, saves: saves.stats?.() });
  server.close();
  arrivalScope.dispose();
  if (arrivals !== undefined) await within(3000, async () => { await arrivals.flush(); await arrivals.flush(); })
    .catch(() => { log({ at: 'zone-entries.drain-timeout', channel: release.channel }); });
  if (sessions !== undefined) {
    sessions.endAll();
    await within(3000, () => sessions.drain()).catch(() => { log({ at: 'room-sessions.drain-timeout', channel: release.channel }); });
  }
  if (roomGame !== undefined) await within(3000, async () => { await roomGame.flush(); await roomGame.flush(); })
    .catch(() => { log({ at: 'room-game-metrics.drain-timeout', channel: release.channel }); });
  reports.flushGameMetrics();
  reports.dispose();
  await reports.settled();
  const recorded=await playtest?.close();if(recorded===false)log({at:'playtest.incomplete'});
  process.exit(written ? code : 1);
})(); };
await new Promise<void>(resolve => { server.listen(port, host, resolve); });
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('Dedicated server has no bound TCP address');
// MMO-PLAN MP2.3 (Q33): guests idle `GUEST_EXPIRY_DAYS` go nightly. Unset is off: switching it on is Jake's.
const expiryDays = guestExpiryDays(process.env);
log({ at: 'guests.expiry', days: expiryDays ?? 'off' });
if (expiryDays !== undefined && saves.expire !== undefined) startGuestExpiry(new Scope('guest-expiry'), { days: expiryDays, sweep: saves.expire, log });
if (process.connected && process.send !== undefined) process.send({ kind: 'world-ready', pid: process.pid, port: address.port });
metrics?.watch(world);
reports.watch(world);
// A metrics port already taken never stops the game: the line says so, and the alarms see no scrape (SC3).
const metricsListening = metrics === undefined || metricsAt === undefined ? undefined : await metrics.listen(metricsAt).catch((error: unknown) => { log({ at: 'metrics.refused', port: metricsAt, error: String(error) }); return undefined; });
log({ at: 'server.listening', ...(metricsListening === undefined ? {} : { metrics: metricsListening }), host, port: address.port, build, cells, crossing, trustProxy: trust.trustProxy, origins: trust.allowedOrigins ?? '*', serial: release.serial, epoch: release.saveEpoch, node: process.version });
// The door keeps Rapier only to read a new build's packs, so this costs no worker a tick.
const reads: PackReads = { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 }, wasm = new URL('rapier.wasm', import.meta.url);
// QA 11-24 row 61: the wasm is read once; Rapier is idempotent, so each later read only made garbage for the door's GC.
const readRapier = async (): Promise<Awaited<ReturnType<typeof loadRapier>>> => loadRapier(await readFile(wasm));
let rapierRead: ReturnType<typeof loadRapier> | undefined;
const rapier = async (): Promise<Awaited<ReturnType<typeof loadRapier>>> => {
  rapierRead ??= readRapier();
  try { return await rapierRead; } catch (error) { rapierRead = undefined; throw error; }
};
// The bundle and its packs reach disk before anyone hears a countdown, so the move costs a restart and no download. A bad hash stops here, with
// everyone still playing, and the next look tries again. `ExecStartPre` moves `current` (E7.2c, C21).
const pullScript = process.env['PULL_SCRIPT'];
async function pullBundle(script: string): Promise<void> {
  const [code] = await once(spawn(process.execPath, [script, '--fetch'], { stdio: ['ignore', 'inherit', 'inherit'] }), 'exit') as [number | null];
  if (code !== 0) throw new Error('The pull refused this release');
}
const watch = new ReleaseWatch({ read: readRelease, serving: release, ...(poll === undefined ? {} : { everyMs: Number(poll) }), failed: error => { log({ at: 'release.failed', error: String(error) }); },
  requiredShards: async next => {
    const released = next.shards.map(shard => shard.slug);
    if (pullScript === undefined) return releasedWorldShards(listed, released);
    await pullBundle(pullScript);
    const bundleCells = await readPulledReleaseCells(process.env['WILDSHARD_HOME'] ?? '/var/lib/wildshard/production', next, releaseKey);
    return releasedWorldShards(listed, released, bundleCells);
  },
  changed: async (next, shards) => {
    const nextCatalogue = await readReleaseItems(next.items, { origin, cache }, reads);
    for (const slug of shards) await readPackFolder(slug, next.engineBuild, await rapier(), { origin, cache }, reads, undefined, nextCatalogue);
    world.beginGrace(next.engineBuild);
  } });
// SA33: a cell the API placed opens on this running server within a look, on a worker of its own, with no grace and no restart. Its shard's
// server pack must be in this build's book or, SA47, in the cook's index of the shardfile hash the placement names: one in neither is
// refused here, before any worker boots, and asked for again next look.
placements = placementAt === undefined || placementKey === undefined || listed.trim() !== WHOLE_GRID ? null : new PlacementWatch({
  read: () => fetchPlacementFile(placementAt, placementKey), channel: release.channel, ...(poll === undefined ? {} : { everyMs: Number(poll) }),
  failed: error => { log({ at: 'placement.failed', error: String(error) }); },
  // MZ33: a cell the file stops naming (a `wildshard delete`) leaves the grid, and the rest re-slot as a page does; the workers hear the
  // door's new list, so a room's frame (read live) and a fresh page agree with no restart
  keep: file => {
    const before = JSON.stringify(placedCells()), gone = keepPlacedCells(placementSlots(file));
    if (JSON.stringify(placedCells()) !== before) {
      log({ at: 'placement.kept', gone });
      void (async () => { try { await world.activateCells([]); } catch (error) { log({ at: 'placement.keep-failed', error: String(error) }); } })();
    }
    return gone;
  },
  // QA 11-24 row 61: a cell the world already runs counts as opened once placed, so no later look reads its pack again.
  open: placementOpener({
    read: async row => { await readPackFolder(row.slug, build, await rapier(), { origin, cache }, reads, row.hash, catalogue); },
    place: (row, file) => { placeCell(row, file); }, running: instance => world.hasCell(instance), open: instances => world.openCells(instances),
    refused: (row, error) => { log({ at: 'placement.refused', instance: row.instance, slug: row.slug, error: String(error) }); },
  }) });
const activationToken = setting('COOK_ACTIVATION_TOKEN');
if (activationToken !== undefined) {
  if (placementAt === undefined || placementKey === undefined || listed.trim() !== WHOLE_GRID) throw new Error('Upload activation needs a whole-grid placement receiver');
  activationReceiver = uploadActivationReceiver(activationToken, uploadActivator({channel: release.channel, build,
    read: () => fetchPlacementFile(placementAt, placementKey),
    preload: async (slug, hash) => {
      const input = await readPackFolder(slug, build, await rapier(), {origin, cache}, reads, hash, catalogue, true);
      return {clientPlan: rawServerPlan(input.sections, input.product)};
    },
    place: (row, file) => {placeCell(row, file);}, open: instances => world.activateCells(instances),
    opened: instance => Object.hasOwn(world.health().table, instance), catalogue: catalogueCell,
  }));
}
void placements?.look();
process.once('SIGTERM', () => { watch.dispose(); placements?.dispose(); stop(0); });

// An IPC-launched proof owns this process; a vanished parent must still drain saves.
if (process.channel !== undefined) {
  process.once('disconnect', () => { watch.dispose(); placements?.dispose(); stop(0); });
  if (!process.connected) { watch.dispose(); placements?.dispose(); stop(0); }
}
