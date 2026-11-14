#!/usr/bin/env node
// Required push-CI smoke against Vite's built dist, using the real title and session owners.
// No skipintro, injected world, gameplay service stubs, harness scheduler, or screenshot readiness oracle.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserPool, parallel } from './pool.mjs';
import { registerCaptureTrace } from './capture-trace.mjs';
import { serve } from './serve.mjs';
import { NAME_ASKED, saveFixture } from '../debug-settings.mjs';
import { captureBootFrame } from './black-frame.mjs';
import { observeTitleCapture } from './title-trace.mjs';
import { gridBootWaitHistory } from './grid-boot-waits.mjs';
import { gridFloorDocumentIdentity, runFloorGridRoute, gridFloorWitnessFailures } from '../frame-floor-grid.mjs';
import { finishPlayProfile, finishStallProfile, startStallProfile } from '../loading-flow/stalls.mjs';

/** A locked experimental card is not a public gameplay entry. Its direct chunk
 * page must still hydrate under the unwaived public playing envelope (call44).
 * @param {{shard:string,appState:string,entered?:boolean,playerValid:boolean,fatal:string[],frame:number,renderFrame:number}} observation */
export function publicPolicyAdmission(observation) {
  const developer = Object.hasOwn(document.documentElement.dataset, 'dev');
  const play = document.querySelector('.ws-menu-play');
  const locked = play !== null && play.hasAttribute('disabled') && /coming soon/iu.test(play.textContent);
  const admitted = !developer && locked && observation.shard === 'nine-dragon-stack' && observation.appState === 'title' &&
    observation.entered === false && observation.playerValid && Number.isFinite(observation.renderFrame) && observation.renderFrame > 0 && observation.frame > 0 && observation.fatal.length === 0 && document.querySelector('#hud') !== null;
  return { admitted, developer, locked, frame: observation.frame, renderFrame: observation.renderFrame };
}

/** Browser-side observation; also exercised against fatal and incomplete boot fixtures. */
export function bootObservation() {
  const fatal = [...document.querySelectorAll('#wserr,.ws-load-error,.ws-game-dev-alert,[data-boot-fatal]')].map(node => node.textContent || 'fatal');
  const probe = /** @type {import('../../src/client/engine/debug/probe').EngineProbe | undefined} */ (window.__wildshard);
  if (!probe?.world) return { fatal, ready: false, frame: -1, shard: '', grid: null, titlePreparation: null, appState: 'unavailable', playerValid: false, renderFrame: -1 };
  const world = probe.requireWorld(), state = probe.state();
  const { grid: exposed, titlePreparation: titleOwner } = world.game.app.debug.snapshot();
  /** @type {unknown} */ const titlePreparation = typeof titleOwner === 'object' && titleOwner !== null && 'state' in titleOwner && typeof titleOwner.state === 'function' ? titleOwner.state() : null;
  const grid = typeof exposed === 'object' && exposed !== null && 'state' in exposed && typeof exposed.state === 'function' ? exposed.state() : null;
  const hud = document.querySelector('#hud');
  const revealing = document.querySelector('.ws-grid-reveal') !== null;
  const entered = world.hud.entered && !world.hud.paused, frameGate = world.game.frameGate();
  const playerValid = [state.player.pos.x, state.player.pos.y, state.player.pos.z, state.player.health].every(Number.isFinite) && state.player.health > 0;
  const ready = state.appState === 'play' && entered && frameGate && hud !== null && !hud.classList.contains('intro') && !revealing &&
    playerValid;
  return { fatal, ready, entered, revealing, frameGate, frame: probe.app.clock.frame, drawnFrame: world.game.frameCount,
    clockPaused: world.game.app.clock.paused, held: world.game.hold, dead: world.game.dead,
    visibility: document.visibilityState, states: [...world.game.app.stateHistory],
    shard: probe.shard.slug, grid, titlePreparation, appState: state.appState, playerValid, renderFrame: world.game.renderer.info.render.frame };
}

/** Require actual warm-owner completion before starting the native capture clock.
 * The grid's initial catalogue title has no world or finish-stage owners.
 * @param {{appState:string,titlePreparation:unknown}} observation @param {boolean} [catalogueOnly] */
export function titleCaptureReady(observation, catalogueOnly = false) {
  if (observation.appState === 'unavailable') return catalogueOnly && observation.titlePreparation === null;
  const state = observation.titlePreparation;
  if (typeof state !== 'object' || state === null || !('pending' in state) || !Array.isArray(state.pending) ||
    !state.pending.every((/** @type {unknown} */ name) => name === 'shaders' || name === 'first-world-frame') ||
    !('issue' in state) || (state.issue !== null && typeof state.issue !== 'string')) throw new Error('Missing title preparation owners');
  if (state.issue !== null) throw new Error(`Title preparation failed: ${state.issue}`);
  return state.pending.length === 0;
}

/** @param {import('playwright').Page} page @param {string[]} faults @param {(observation:ReturnType<typeof bootObservation>) => Promise<boolean>} condition @param {string} label @param {number} deadline @param {(label:string, observation:Awaited<ReturnType<typeof bootObservation>>)=>void} [observe] */
async function until(page, faults, condition, label, deadline, observe) {
  while (Date.now() < deadline) {
    if (faults.length > 0) throw new Error(faults.join('\n'));
    const observed = await page.evaluate(bootObservation);
    observe?.(label, observed);
    if (observed.fatal.length > 0) throw new Error(`Fatal boot: ${observed.fatal.join('\n')}`);
    if (await condition(observed)) return;
    await new Promise(resolve => { setTimeout(resolve, 100); });
  }
  throw new Error(`Boot deadline: ${label}; ${JSON.stringify(await page.evaluate(bootObservation))}`);
}

/** API-CLOUDFLARE AC11: a release page posts to `api.wildshard.io`, another origin, so a stubbed answer (and its
 * preflight) carries CORS, or the page logs a CORS error. The smoke never reaches the real API.
 * @param {import('playwright').Route} route @param {number} [status] */
export function answerApi(route, status = 204) {
  return route.fulfill({ status, body: '', headers: {
    'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-review-password' } });
}

/** Preserve the original report behind a static-preview transport failure, including lifecycle diagnostics.
 * @param {string} url @param {string} method @param {string|null} body @returns {unknown} */
export function bootErrorReport(url, method, body) {
  if (new URL(url).pathname !== '/api/errors' || method !== 'POST') return null;
  try { return JSON.parse(body ?? 'null'); } catch { return { malformed: body }; }
}

/** Lifecycle reports describe navigation/frame health and never raise the game's error UI.
 * Keep their full payloads as evidence; only the explicit nonfatal diagnostic is acknowledged.
 * @param {unknown} report @param {boolean} observedGridNavigation */
export function bootLifecycleDiagnostic(report, observedGridNavigation) {
  return observedGridNavigation && typeof report === 'object' && report !== null && 'system' in report && report.system === 'lifecycle' &&
    'fatal' in report && report.fatal === false && 'message' in report && typeof report.message === 'string' &&
    /^boot after the last page ended on "hide" \(nav navigate\): \d+ frames \/ 6s$/u.test(report.message);
}

/** Read the actual built title's installed catalogue, without loading or injecting a world. */
export function bootCatalogue() {
  // Cold titles install complete scalar metadata; selected discovery may contain
  // only one world. Historical titles instead installed the full prepared list.
  /** @type {unknown} */ const title = Reflect.get(globalThis, Symbol.for('game.titleManifests'));
  /** @type {unknown} */ const installed = title === undefined ? Reflect.get(globalThis, Symbol.for('game.shards')) : title;
  if (!Array.isArray(installed) || installed.length === 0) throw new Error('Missing built title shard catalogue');
  return installed.map((/** @type {unknown} */ row) => {
    if (typeof row !== 'object' || row === null || !('slug' in row) || typeof row.slug !== 'string' ||
      !('status' in row) || typeof row.status !== 'string' ||
      ('shardSelect' in row && typeof row.shardSelect !== 'boolean')) throw new Error('Invalid built title shard catalogue row');
    return { slug: row.slug, status: row.status, legacy: 'legacy' in row && row.legacy === true,
      shardSelect: !('shardSelect' in row) || row.shardSelect !== false };
  });
}

/** Each case runs in its own slot's browser; retire that slot's earlier GPU contexts before the grid's two-document boot.
 * @template T @param {{browser:(slot:number)=>Promise<T>,release:(slot:number)=>Promise<void>}} pool
 * @param {'standalone'|'grid'|'public-policy'} mode @param {number} [slot] @returns {Promise<T>} */
export async function bootCaseBrowser(pool, mode, slot = 0) {
  if (mode === 'grid') await pool.release(slot);
  return pool.browser(slot);
}

/** BROWSER-TESTS-BENCH BB2 (J231): how many cases boot at once, each in its own browser against the one preview server.
 * 1 keeps the old one-after-another order; Ring 1 passes its measured choice.
 * @param {string|undefined} value @returns {number} */
export function bootJobs(value) {
  if (value === undefined) return 1;
  if (!/^[1-8]$/u.test(value)) throw new Error('usage: --jobs=1..8');
  return Number(value);
}

/** Every public primary enters through its real public button; experimental primaries enter with Developer on.
 * @param {readonly {slug:string,status:string,legacy:boolean,shardSelect?:boolean}[]} catalogue
 * @param {'all'|'public'|'developer'|'grid'} [group]
 * @returns {readonly (readonly ['standalone'|'grid'|'public-policy',string,boolean])[]} */
export function bootCases(catalogue, group = 'all') {
  if (!['all', 'public', 'developer', 'grid'].includes(group)) throw new Error('Unknown boot case group');
  const seen = new Set();
  for (const row of catalogue) {
    if (!/^[a-z0-9_-]+$/u.test(row.slug) || seen.has(row.slug) || !['live', 'earlyAccess', 'experimental', 'hidden'].includes(row.status)) throw new Error('Invalid or duplicate built title shard');
    seen.add(row.slug);
  }
  // Match titleCards: a grid-only plot has no picker card to tap. Its catalogue
  // remains available to Explorer, independent of standalone entry coverage.
  const primary = catalogue.filter(row => !row.legacy && row.shardSelect !== false);
  if (!primary.some(row => row.slug === 'sunscar-dunes')) throw new Error('Signal page-ready case is missing from the built catalogue');
  const publicRows = primary.filter(row => row.status !== 'experimental' && row.status !== 'hidden');
  const home = publicRows.at(0)?.slug ?? (process.env.WILDSHARD_RING === '1' ? 'sunscar-dunes' : undefined); // Ring 1's three products are all Developer cards.
  if (home === undefined) throw new Error('No public shard page-ready cases');
  if (process.env.WILDSHARD_RING !== '1' && !primary.some(row => row.slug === 'nine-dragon-stack')) throw new Error('Nine Developer-off page-ready case is missing from the built catalogue'); // Ring 1 builds three products; Ring 2 still holds Nine to this.
  // Direct Nine chunk hydration uses the public playing envelope even while
  // its experimental picker card stays locked. The Developer case separately
  // proves entered gameplay; admission is never labelled public gameplay.
  const publicCases = primary.filter(row => row.status !== 'hidden' && (row.status !== 'experimental' || row.slug === 'nine-dragon-stack'))
    .map(row => /** @type {const} */ ([row.status === 'experimental' ? 'public-policy' : 'standalone', row.slug, false]));
  const developerCases = primary.filter(row => row.status === 'experimental' || row.status === 'hidden').map(row => /** @type {const} */ (['standalone', row.slug, true]));
  const gridCases = [/** @type {const} */ (['grid', home, false])];
  return group === 'public' ? publicCases : group === 'developer' ? developerCases : group === 'grid' ? gridCases : [...publicCases, ...developerCases, ...gridCases];
}

/** Plan a genuine road crossing into the actual Signal cell, never a home/title substitute.
 * @param {unknown} state @returns {import('../frame-floor-grid.mjs').FloorGridPlan} */
export function bootSignalRoadPlan(state) {
  if (typeof state !== 'object' || state === null || !('cells' in state) || !Array.isArray(state.cells)) throw new Error('Missing grid cell catalogue');
  const targets = state.cells.filter((/** @type {unknown} */ row) => typeof row === 'object' && row !== null && 'slug' in row && row.slug === 'sunscar-dunes');
  const target = /** @type {unknown} */ (targets.at(0));
  if (targets.length !== 1 || typeof target !== 'object' || target === null || !('instance' in target) || typeof target.instance !== 'string' || target.instance.length === 0 ||
    !('cell' in target) || !Array.isArray(target.cell) || target.cell.length !== 2) throw new Error('Signal grid cell is missing or ambiguous');
  const x = /** @type {unknown} */ (target.cell[0]), z = /** @type {unknown} */ (target.cell[1]);
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isSafeInteger(x) || !Number.isSafeInteger(z)) throw new Error('Invalid Signal grid address');
  const pitch = 'pitch' in state && state.pitch !== undefined ? state.pitch : 555;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid grid pitch');
  // Let the owned home checkpoint and leave commit on the neutral road midpoint
  // before approaching Signal. The nearby border can already select Signal.
  return { name: 'boot-signal-road-entry', from: null, to: target.instance, movement: 'road-hover',
    start: { x: x * pitch, z: z * pitch + pitch / 2 }, waypoints: [{ x: x * pitch, z: z * pitch + 245 }],
    requiredResidents: [target.instance], finishOnArrival: true };
}

/** A ready home or prepared-only destination cannot satisfy the road-entry gate.
 * @param {import('../frame-floor-grid.mjs').FloorGridWitness} witness */
export function verifyBootSignalRoad(witness) {
  const failures = gridFloorWitnessFailures(witness);
  const cell = witness.after.cells.find(row => row.instance === witness.plan.to);
  if (witness.plan.from !== null || cell?.slug !== 'sunscar-dunes') failures.push('Required Signal road entry was not driven');
  if (!witness.trace.some(row => row.current === null)) failures.push('No actual road frame was observed');
  if (failures.length > 0) throw new Error(`Signal road entry: ${failures.join('; ')}`);
}

/** A short real Template entry/departure exercises the durable crossing without spending a diagonal home trip.
 * @param {unknown} state @returns {{entry:import('../frame-floor-grid.mjs').FloorGridPlan,exit:import('../frame-floor-grid.mjs').FloorGridPlan}} */
export function bootTemplateRoadPlans(state) {
  if (typeof state !== 'object' || state === null || !('cells' in state) || !Array.isArray(state.cells)) throw new Error('Missing grid cell catalogue');
  const targets = state.cells.filter((/** @type {unknown} */ row) => typeof row === 'object' && row !== null && 'slug' in row && row.slug === '_template' &&
    'instance' in row && typeof row.instance === 'string').sort((a, b) => a.instance.localeCompare(b.instance));
  const target = /** @type {unknown} */ (targets.at(0));
  if (typeof target !== 'object' || target === null || !('instance' in target) || typeof target.instance !== 'string' || target.instance.length === 0 ||
    !('cell' in target) || !Array.isArray(target.cell) || target.cell.length !== 2) throw new Error('Template grid cell is missing or invalid');
  const x = /** @type {unknown} */ (target.cell[0]), z = /** @type {unknown} */ (target.cell[1]);
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isSafeInteger(x) || !Number.isSafeInteger(z)) throw new Error('Invalid Template grid address');
  const pitch = 'pitch' in state && state.pitch !== undefined ? state.pitch : 555;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid grid pitch');
  const road = { x: x * pitch - pitch / 2, z: z * pitch }, inside = { x: x * pitch - 230, z: z * pitch };
  return { entry: { name: 'boot-template-entry', from: null, to: target.instance, movement: 'road-hover', start: road,
    waypoints: [inside], requiredResidents: [target.instance], finishOnArrival: true },
  exit: { name: 'boot-template-return', from: target.instance, to: null, movement: 'road-hover', waypoints: [road], requiredResidents: [], finishOnArrival: true } };
}

/** Read actual durable storage, never the save service's retryable in-memory fallback.
 * @param {string} instance */
export function bootTemplateCheckpoint(instance, raw = localStorage.getItem(`wildshard.save.v2@1.${instance}`)) {
  if (raw === null) throw new Error('Template crossing has no durable checkpoint');
  const document = JSON.parse(raw), served = document?.keys?.continuation;
  if (served !== undefined) { // A server's own document: src/server/host/standalone/continuation.ts.
    const run = served.data;
    if (served.v !== 1 || !Number.isSafeInteger(run?.tick) || run.tick < 0 || typeof run?.snapshot !== 'string' || run.snapshot.length === 0) throw new Error('Template crossing has an invalid durable checkpoint');
    return { instance, mode: 'exact', revision: run.tick, integrity: 0, snapshotCharacters: run.snapshot.length, storageCharacters: raw.length };
  }
  const slot = document?.keys?.['platform.region'], data = slot?.data;
  if (slot?.v !== 1 || !Number.isSafeInteger(data?.revision) || data.revision < 1 || !Number.isSafeInteger(data?.integrity) ||
    data.integrity < 0 || data.integrity > 0xffffffff ||
    !(data.mode === 'exact' && typeof data.snapshot === 'string' && data.snapshot.length > 0 || data.mode === 'logical' && data.snapshot === null && typeof data.logical === 'object' && data.logical !== null)) {
    throw new Error('Template crossing has an invalid durable checkpoint');
  }
  return { instance, mode: data.mode, revision: data.revision, integrity: data.integrity, snapshotCharacters: data.snapshot?.length ?? 0, storageCharacters: raw.length };
}

/** A world's document: a server's, in IndexedDB under its own two names (src/client/engine/saves/indexed.ts,
 * src/server/host/standalone/continuation.ts), newest of the two. On a wire a page's localStorage document holds only where it stood
 * (`saveLocation`, on any checkpoint inside the cell), so it answers only when no server wrote.
 * @param {string} instance @returns {Promise<string | null>} */
export async function bootStoredSave(instance) {
  const prefix = 'wildshard.save.v2@1.', page = localStorage.getItem(`${prefix}${instance}`);
  if (!(await indexedDB.databases()).some(row => row.name === 'wildshard-saves@1')) return page;
  const opening = indexedDB.open('wildshard-saves@1');
  /** @type {IDBDatabase} */ const database = await new Promise((resolve, reject) => { opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error ?? new Error('Save storage refused')); }; });
  try {
    if (!database.objectStoreNames.contains('saves')) return page;
    const store = database.transaction('saves').objectStore('saves');
    const read = (/** @type {string} */ name) => new Promise((resolve, reject) => { const reading = store.get(`${prefix}${name}`); reading.onsuccess = () => { resolve(reading.result); }; reading.onerror = () => { reject(reading.error ?? new Error('Save storage refused')); }; });
    const rows = (await Promise.all([read(`standalone-${instance}`), read(`standalonealt-${instance}`)])).filter(value => typeof value === 'string');
    const tick = (/** @type {string} */ row) => JSON.parse(row)?.keys?.continuation?.data?.tick ?? -1;
    return rows.sort((a, b) => tick(b) - tick(a)).at(0) ?? page;
  } finally { database.close(); }
}

/** @param {{entry:import('../frame-floor-grid.mjs').FloorGridWitness,exit:import('../frame-floor-grid.mjs').FloorGridWitness,checkpoint:ReturnType<typeof bootTemplateCheckpoint>}} result */
export function verifyBootTemplateRoad(result) {
  const failures = [...gridFloorWitnessFailures(result.entry), ...gridFloorWitnessFailures(result.exit)];
  const id = result.entry.plan.to, cell = result.entry.after.cells.find(row => row.instance === id);
  if (result.entry.plan.from !== null || cell?.slug !== '_template' || result.exit.plan.from !== id || result.exit.plan.to !== null) failures.push('Required Template entry and checkpoint-backed road return were not driven');
  if (result.checkpoint.instance !== id || result.checkpoint.storageCharacters <= 0) failures.push('Template durable checkpoint does not match its crossing');
  if (failures.length > 0) throw new Error(`Template checkpoint roundtrip: ${failures.join('; ')}`);
}

/** Failure-only: compare the small travel readout with the observer's actual owner.
 * @returns {unknown} */
export function bootRoadCompletionState() {
  const api = window.__wildshard, game = api?.world?.game, grid = api?.shard?.grid;
  /** @param {unknown} value @param {string} key @returns {unknown} */
  const field = (value, key) => typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  const travel = field(grid, 'travelState');
  /** @type {unknown} */
  const compact = typeof travel === 'function' ? Reflect.apply(travel, grid, []) : null;
  const session = field(compact, 'live'), live = field(session, 'live'), crossing = field(session, 'crossing');
  const pending = field(live, 'pending'), scope = game?.levelScope;
  /** @type {unknown} */
  const stop = Reflect.get(window, '__frameFloorGridStop');
  const ids = typeof game?.levelSystemIds === 'function' ? game.levelSystemIds() : null;
  const at = performance.now(), lastDrawn = game?.frameRafTime ?? null, ui = game?.app.ui;
  return {at, timeOrigin: performance.timeOrigin, stop: stop ?? null,
    compact: compact === null ? null : {inside: field(compact, 'inside'), current: field(live, 'current'), ready: field(live, 'gameplayReady'),
      pendingCount: Array.isArray(pending) ? pending.length : null, phase: field(crossing, 'phase')},
    observer: ids === null ? null : {present: ids.includes('harness.walk'), systems: ids.length},
    owner: scope === undefined ? null : {name: scope.name, disposed: scope.disposed, disposing: scope.disposing},
    view: {coverage: ui?.presentation, still: ui?.still, blocking: ui?.blocking, top: ui?.top,
      visibility: typeof document === 'undefined' ? null : document.visibilityState,
      hidden: typeof document === 'undefined' ? null : document.hidden},
    raf: {ownedRequests: game?.engineScope?.census.rafs ?? null, lastDrawnAt: lastDrawn,
      sinceLastDrawnMs: lastDrawn === null ? null : at - lastDrawn},
    game: game === undefined ? null : {frame: game.frameCount, state: game.app.state}};
}

/** Preserve the original refusal even when the failed page cannot answer diagnostics.
 * @param {()=>Promise<unknown>} read @param {unknown} primary @returns {Promise<Error>} */
export async function bootRoadFailure(read, primary) {
  const cause = primary instanceof Error ? primary : new Error(String(primary));
  let timer, evidence;
  try {
    evidence = JSON.stringify(await Promise.race([Promise.resolve().then(read), new Promise((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error('Road completion diagnostic did not answer in 1000 ms')); }, 1000);
    })]));
  } catch (error) { evidence = JSON.stringify({readRefused: error instanceof Error ? error.message : String(error)}); }
  finally { clearTimeout(timer); }
  return new Error(`${cause.message}; roadCompletion=${evidence}`, {cause});
}

/** The Template roundtrip and mandatory Signal entry share the original road leg's 90-second budget.
 * @param {import('playwright').Page} page @param {string[]} faults
 * @param {import('../frame-floor-grid.mjs').FloorGridPlan} plan @param {import('../frame-floor-grid.mjs').FloorGridDocumentIdentity} documentOrigin
 * @param {number} deadline @param {string} label */
async function bootRoadRoute(page, faults, plan, documentOrigin, deadline, label) {
  let finished = false;
  const route = (async () => {
    try { return { witness: await runFloorGridRoute(page, plan, documentOrigin) }; }
    catch (error) { return { error }; }
    finally { finished = true; }
  })();
  try { await until(page, faults, () => Promise.resolve(finished), label, deadline); }
  catch (error) { throw await bootRoadFailure(() => page.evaluate(bootRoadCompletionState), error); }
  const result = await route;
  if ('error' in result) throw result.error instanceof Error ? result.error : new Error(String(result.error));
  return result.witness;
}

/** @param {import('playwright').Page} page @param {string[]} faults
 * @param {import('./black-frame.mjs').BootFrameSample[]} frames @param {number} deadline */
async function bootTemplateRoad(page, faults, frames, deadline) {
  const plans = bootTemplateRoadPlans((await page.evaluate(bootObservation)).grid), documentOrigin = await page.evaluate(gridFloorDocumentIdentity);
  const entry = await bootRoadRoute(page, faults, plans.entry, documentOrigin, deadline, 'Template road entry');
  const initial = await page.evaluate(bootObservation);
  await until(page, faults, async () => { const observed = await page.evaluate(bootObservation); return observed.ready && observed.frame >= initial.frame + 10; }, 'Template ten live gameplay frames', deadline);
  await captureBootFrame(page, 'grid Template entered', deadline, frames);
  const exit = await bootRoadRoute(page, faults, plans.exit, documentOrigin, deadline, 'Template checkpoint-backed return');
  const instance = plans.entry.to ?? '';
  // A server writes this from its worker, a moment behind the frames.
  await until(page, faults, async () => {
    try { bootTemplateCheckpoint(instance, await page.evaluate(bootStoredSave, instance)); return true; } catch { return false; }
  }, 'Template durable checkpoint', Math.min(deadline, Date.now() + 15000)).catch(() => undefined);
  const result = { entry, exit, checkpoint: bootTemplateCheckpoint(instance, await page.evaluate(bootStoredSave, instance)) };
  verifyBootTemplateRoad(result);
  await captureBootFrame(page, 'grid Template checkpoint return', deadline, frames);
  return result;
}

/** Keep the existing home deadline and the road proof's unchanged shared 90-second budget.
 * @param {import('playwright').Page} page @param {string[]} faults
 * @param {import('./black-frame.mjs').BootFrameSample[]} frames @param {number} deadline */
async function bootSignalRoad(page, faults, frames, deadline) {
  const plan = bootSignalRoadPlan((await page.evaluate(bootObservation)).grid);
  const documentOrigin = await page.evaluate(gridFloorDocumentIdentity);
  const witness = await bootRoadRoute(page, faults, plan, documentOrigin, deadline, 'Signal road entry');
  verifyBootSignalRoad(witness);
  const initial = await page.evaluate(bootObservation);
  await until(page, faults, async () => { const observed = await page.evaluate(bootObservation); return observed.ready && observed.frame >= initial.frame + 10; }, 'Signal ten live gameplay frames', deadline);
  await captureBootFrame(page, 'grid Signal road entry', deadline, frames);
  return witness;
}

/** @param {import('playwright').Browser} browser @param {string} base */
export async function discoverCatalogue(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  try {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: false }); await saveFixture(context, NAME_ASKED);
    const page = await context.newPage(), url = new URL(base);
    for (const [key, value] of Object.entries({ tier: 'phone', touch: '1', mute: '1', nolock: '1', sw: '0' })) url.searchParams.set(key, value);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('.ws-main-logo').waitFor({ timeout: 30000 });
    return await page.evaluate(bootCatalogue);
  } finally { await context.close(); }
}

/** Browser-side: the first world collider within 3 m above the player's head in the live physics (null: open sky). */
export function spawnOverhead() {
  const probe = window.__wildshard;
  const physics = probe.requireWorld().physics, feet = probe.state().player.pos;
  // from just above the 1.8 m capsule (its own body is not overhead), solid, sensors (water volumes) skipped
  const from = feet.y + 1.9, hit = physics.world.castRay(new physics.R.Ray({ x: feet.x, y: from, z: feet.z }, { x: 0, y: 1, z: 0 }), 3, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS);
  return hit === null ? null : { feet, overheadY: from + hit.timeOfImpact };
}

/** `developer`: a standalone case with Developer on, for a shard that is still Developer-only (Signal Dunes: SF57's composer
 * coverage broke its boot on main, 9fb0cca1d, and no public case could see it).
 * `arrival` consumes the real travel handoff for a grid-only product with no picker card.
 * @param {import('playwright').Browser} browser @param {string} base @param {'standalone'|'grid'|'public-policy'|'arrival'} mode @param {string} out @param {string} [shard] @param {boolean} [developer]
 * @param {((page:import('playwright').Page)=>Promise<void>)|null} [afterGameplay]
 * @param {((context:import('playwright').BrowserContext)=>Promise<void>)|null} [configureContext] */
export async function bootCase(browser, base, mode, out, shard = 'driftwood-isle', developer = false, afterGameplay = null, configureContext = null) {
  // CI's macOS runner renders the phone tier at ~0.3 fps, so a case needs more than a minute of wall clock.
  const started = Date.now();
  let deadline = started + 150000;
  /** @type {{initial:number|null,final:number|null}} */
  const gameplayFrames = {initial:null,final:null};
  const receipt = mode !== 'grid' && shard !== 'driftwood-isle' ? shard : mode;
  /** @type {Record<string, number>} */ const phases = {};
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  if (configureContext !== null) await configureContext(context);
  // Both ordinary documents read the same device choice. Standalone proves the public default too.
  await saveFixture(context, { scope: 'device', key: 'devMode', data: mode === 'grid' || developer }); await saveFixture(context, NAME_ASKED);
  // Existing probe permission for the one initial road pose; no scheduler or service is replaced.
  if (mode === 'grid') await context.addInitScript(() => { window.__wildshardHarness = { seed: 357, capture: null }; });
  // Static dist has no serverless API. Acknowledge telemetry and recorded nonfatal lifecycle diagnostics only.
  let telemetryPosts = 0;
  await context.route('**/api/telemetry', async route => {
    const method = route.request().method();
    if (method === 'OPTIONS') { await answerApi(route); return; }
    if (method !== 'POST') { await route.continue(); return; }
    telemetryPosts++; await answerApi(route);
  });
  let gridNavigationIntent = false, gridNavigationObserved = false;
  await context.route('**/api/errors', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') { await answerApi(route); return; }
    const report = bootErrorReport(request.url(), request.method(), request.postData());
    if (bootLifecycleDiagnostic(report, gridNavigationObserved)) { await answerApi(route); return; }
    // Same-origin, the static server answers (the old transport failure); cross-origin it would be the real API.
    const from = request.headers().origin;
    if (from === undefined || from === new URL(request.url()).origin) { await route.continue(); return; }
    await answerApi(route, 404);
  });
  const page = await context.newPage();
  /** @type {import('playwright').CDPSession | null} */ let stallProfile = null;
  registerCaptureTrace(page, out, receipt);
  page.on('framenavigated', frame => {
    if (gridNavigationIntent && frame === page.mainFrame()) gridNavigationObserved = true;
  });
  /** @type {import('./black-frame.mjs').BootFrameSample[]} */ const frames = [];
  /** @type {string[]} */ const faults = [];
  /** @type {unknown[]} */ const reports = [];
  const gridWaits = gridBootWaitHistory();
  const observeGridWait = (/** @type {string} */ label, /** @type {Awaited<ReturnType<typeof bootObservation>>} */ observation) => gridWaits.observe(label, Date.now() - started, observation);
  let lifecycleReports = 0;
  page.on('request', request => {
    const report = bootErrorReport(request.url(), request.method(), request.postData());
    if (new URL(request.url()).pathname !== '/api/errors' || request.method() !== 'POST') return;
    reports.push(report);
    if (bootLifecycleDiagnostic(report, gridNavigationObserved)) lifecycleReports++;
    else faults.push(`Game error report: ${JSON.stringify(report)}`);
  });
  page.on('pageerror', error => faults.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' || /\brefused\b/iu.test(message.text()))
      faults.push(`console ${message.type()}: ${message.text()} ${JSON.stringify(message.location())}`);
  });
  page.on('crash', () => faults.push('Page crashed'));
  page.on('response', response => { if (response.status() >= 400) faults.push(`HTTP ${response.status()}: ${response.url()}`); });
  // Remember a transient fatal even if the UI later removes it or the grid navigates to a new document.
  await context.addInitScript(() => {
    const seen = new Set();
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('#wserr,.ws-load-error,.ws-game-dev-alert,[data-boot-fatal]')) {
        const text = node.textContent || 'fatal';
        if (!seen.has(text)) { seen.add(text); console.error(`BOOT_FATAL: ${text}`); }
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  try {
    const url = new URL(base);
    for (const [key, value] of Object.entries({ tier: 'phone', touch: '1', mute: '1', nolock: '1', sw: '0' })) url.searchParams.set(key, value);
    if (mode !== 'grid') url.searchParams.set('chunk', shard);
    // NINE-DRAGON-BENCHMAX NB6: a standalone load whose props stage sits idle with no named wait is refused at control
    // (the world may build behind the title, so the profile runs from the document's start)
    if (mode === 'standalone') stallProfile = await startStallProfile(page);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (mode !== 'arrival') {
    await until(page, faults, async observed => await page.locator('.ws-main-logo').isVisible() && !(await page.locator('.ws-load').isVisible()) && titleCaptureReady(observed, mode === 'grid'), 'rendered usable title with completed warm-up', deadline);
    phases.titleMs = Date.now() - started;
    await observeTitleCapture(page, join(out, `${receipt}-title`), () => captureBootFrame(page, 'title', deadline, frames));
    if (mode !== 'grid') {
      await page.locator('.ws-main-select').click();
      // Admission enables the entry asynchronously. Every case enters by the one ENTER WORLD
      // (the shardfile, G531; QD7 LD5 removed the LEGACY / SHARDFILE pair).
      if (mode === 'public-policy') {
        if (developer || shard !== 'nine-dragon-stack') throw new Error('Invalid public-policy admission case');
        await until(page, faults, async () => {
          const observed = await page.evaluate(bootObservation), admission = await page.evaluate(publicPolicyAdmission, observed);
          return admission.admitted;
        }, 'Developer-off Nine public-policy hydration and initial draw', deadline);
        const observation = await page.evaluate(bootObservation), admission = await page.evaluate(publicPolicyAdmission, observation);
        await captureBootFrame(page, 'SHARD SELECT', deadline, frames);
        const result = { mode, phases, frames, admission, telemetryPosts, lifecycleReports, gridNavigationObserved,
          elapsedMs: Date.now() - started, ...observation, faults, reports };
        if (!admission.admitted || faults.length > 0 || reports.length > 0) throw new Error(JSON.stringify(result));
        writeFileSync(join(out, `${receipt}.json`), `${JSON.stringify(result, null, 2)}\n`);
        return result;
      }
      const play = page.locator('.ws-menu-play');
      await play.waitFor();
      await until(page, faults, async () => await play.isVisible() && await play.isEnabled(), 'available shard entry', deadline);
      await captureBootFrame(page, 'SHARD SELECT', deadline, frames);
      phases.entryMs = Date.now() - started;
      deadline = Date.now() + 90000;
      await play.click();
    } else {
      // The real grid button writes its one-shot intent and deliberately changes the document.
      gridNavigationIntent = true;
      phases.entryMs = Date.now() - started;
      deadline = Date.now() + 150000;
      // Register before the tap: evaluating the old document while this expected
      // navigation commits destroys its execution context. Keep the same bound.
      await Promise.all([
        page.waitForURL(destination => destination.searchParams.get('chunk') === shard, { waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()) }),
        page.locator('.ws-main-grid').click(),
      ]);
    }
    }
    let revealSkipped = false;
    /** @type {Awaited<ReturnType<typeof finishStallProfile>>['stalls'] | null} */ let stalls = null;
    const gameplay = async (/** @type {boolean} */ requireRings) => {
      const value = await page.evaluate(bootObservation);
      // Skip the grid's sky-down reveal with the player's own tap: it still waits for the rings and the home handoff,
      // but its 7 s camera path no longer costs minutes of wall clock on a runner that draws a frame every few seconds.
      if (value.revealing === true && !revealSkipped) {
        revealSkipped = await page.locator('.ws-grid-reveal').dispatchEvent('pointerdown').then(() => true, () => false);
      }
      if (!value.ready) return false;
      if (mode === 'standalone' || mode === 'arrival') return value.shard === shard && value.grid === null;
      const grid = value.grid;
      if (typeof grid !== 'object' || grid === null || !('home' in grid) || typeof grid.home !== 'string' || grid.home.length === 0 ||
        !('inside' in grid) || grid.home !== grid.inside || (requireRings && (!('ringsReady' in grid) || grid.ringsReady !== true)) ||
        !('cells' in grid) || !Array.isArray(grid.cells) || !grid.cells.some((/** @type {unknown} */ cell) => typeof cell === 'object' && cell !== null && 'instance' in cell && 'shows' in cell && cell.instance === grid.home && cell.shows === 'playing')) return false;
      const session = 'live' in grid ? grid.live : null;
      const live = typeof session === 'object' && session !== null && 'live' in session ? session.live : null;
      return typeof live === 'object' && live !== null && 'current' in live && live.current === grid.home && 'gameplayReady' in live && live.gameplayReady === true;
    };
    if (mode === 'grid') {
      await until(page, faults, () => gameplay(false), 'grid preparation', deadline, observeGridWait);
      phases.preparedMs = Date.now() - started;
      deadline = Date.now() + 90000;
    }
    await until(page, faults, () => gameplay(true), `${mode} gameplay`, deadline, mode === 'grid' ? observeGridWait : undefined);
    phases.gameplayMs = Date.now() - started;
    if (stallProfile !== null) { const read = await finishStallProfile(page, stallProfile); stallProfile = null; stalls = read.stalls; faults.push(...read.faults); }
    const initial = await page.evaluate(bootObservation);
    gameplayFrames.initial = initial.frame;
    phases.framesStartMs = Date.now() - started;
    if (mode === 'grid') { // E463: the settled home spawn stands on its deck / ground, never under a collider (Driftwood's pier)
      const overhead = await page.evaluate(spawnOverhead);
      if (overhead !== null) throw new Error(`grid spawn is under a collider: ${JSON.stringify(overhead)}`);
    }
    // NINE-DRAGON-BENCHMAX NB6 (play): the ten gameplay frames are profiled too, and a stretch in which the main thread
    // worked without a break (a 2 s busy sleep in a frame) is refused, whatever the GPU (scripts/loading-flow/stalls.mjs)
    const playProfile = await startStallProfile(page), playFrom = Number(await page.evaluate('performance.now()'));
    await until(page, faults, async () => (await page.evaluate(bootObservation)).frame >= initial.frame + 10, 'ten live gameplay frames', deadline);
    gameplayFrames.final = (await page.evaluate(bootObservation)).frame;
    /** @type {{ from: number, busyMs: number, playMs: number } | null} */ let playStall = null;
    if (playProfile !== null) { const read = await finishPlayProfile(page, playProfile, playFrom); playStall = read.stall; faults.push(...read.faults); }
    phases.framesCompleteMs = Date.now() - started;
    await captureBootFrame(page, mode === 'grid' ? 'grid HOME' : `${shard} gameplay`, deadline, frames);
    const roadDeadline = Date.now() + 90000;
    const templateRoad = mode === 'grid' ? await bootTemplateRoad(page, faults, frames, roadDeadline) : null;
    const road = mode === 'grid' ? await bootSignalRoad(page, faults, frames, roadDeadline) : null;
    const result = { mode, phases, frames, gameplayFrames, stalls, playStall, gridWaits: gridWaits.samples, templateRoad, road, telemetryPosts, lifecycleReports, gridNavigationObserved, elapsedMs: Date.now() - started, ...await page.evaluate(bootObservation), faults, reports };
    if (faults.length > 0 || result.fatal.length > 0) throw new Error(JSON.stringify(result));
    if (afterGameplay !== null) await afterGameplay(page);
    if (faults.length > 0) throw new Error(JSON.stringify(faults));
    writeFileSync(join(out, `${receipt}.json`), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    await page.screenshot({ path: join(out, `${receipt}-failure.jpg`), type: 'jpeg', quality: 70 }).catch(() => undefined);
    const observation = await page.evaluate(bootObservation).catch(() => null);
    const loading = await page.evaluate(() => ({ text: document.querySelector('.ws-load')?.textContent,
      pending: Reflect.get(document.querySelector('.ws-load') ?? {}, Symbol.for('engine.loading.snapshot')),
      resources: performance.getEntriesByType('resource').map(row => row.toJSON()) })).catch(() => null);
    gameplayFrames.final = observation?.frame ?? null;
    phases.failedMs = Date.now() - started;
    writeFileSync(join(out, `${receipt}.json`), `${JSON.stringify({ mode, phases, frames, gameplayFrames, gridWaits: gridWaits.samples, elapsedMs: Date.now() - started, faults, reports, lifecycleReports, gridNavigationObserved, error: String(error), observation, loading }, null, 2)}\n`);
    throw error;
  } finally { await context.close(); }
}

async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const option = (/** @type {string} */ name) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const out = resolvePath(option('out') ?? 'boot-smoke-results'); mkdirSync(out, { recursive: true });
  const external = option('url');
  const jobs = bootJobs(option('jobs'));
  if (external === undefined && !existsSync(join(root, 'dist/index.html'))) throw new Error('Build dist before running boot smoke');
  const preview = external === undefined ? await serve(root, '', true) : null;
  const base = external ?? preview?.url;
  if (!base) throw new Error('No built preview');
  const pool = browserPool(root, jobs, option('angle') ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader'), true);
  try {
    const browser = await pool.browser(0);
    const group = option('case-group') ?? 'all';
    if (group !== 'all' && group !== 'public' && group !== 'developer' && group !== 'grid') throw new Error('usage: --case-group=all|public|developer|grid');
    const catalogue = await discoverCatalogue(browser, base);
    const cases = bootCases(catalogue, group);
    writeFileSync(join(out, 'cases.json'), `${JSON.stringify({ group, jobs, catalogue, cases }, null, 2)}\n`);
    // Every started case finishes and keeps its receipt before the first failure is thrown (pool.mjs `parallel`).
    await parallel([...cases], jobs, async ([mode, shard, developer], _index, slot) => {
      const isolated = await bootCaseBrowser(pool, mode, slot);
      const result = await bootCase(isolated, base, mode, out, shard, developer);
      console.log(`${mode}: ${mode === 'public-policy' ? 'public-policy admission' : 'gameplay'} PASS in ${result.elapsedMs}ms, frame=${result.frame}, faults=${result.faults.length}`);
    });
  } finally { try { await pool.close(); } finally { preview?.close(); } }
}
if (process.argv[1] && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url) await main();
