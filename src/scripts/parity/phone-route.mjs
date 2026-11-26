#!/usr/bin/env node
// Seventh exact-dist leg. The browser driver never supplies content, readiness, collision or pixels.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { runFloorGridRoute, gridFloorDocumentIdentity, gridFloorWitnessFailures } from '../frame-floor-grid.mjs';
import { phoneRouteObservation, phoneLoadingObservation, phoneBoardWall, phoneWallTarget, watchPhoneEntry, installPhoneTitlePaint, phoneGridEntryCondition } from './phone-route-page.mjs';
import { openPhoneBrowser } from './phone-route-browser.mjs';
import { serve } from './serve.mjs';

/** @param {import('./phone-route.mjs').PhoneObservation} state */
export function phoneRoutePlans(state) {
  const home = state.cells.find(row => row.instance === state.home && row.slug === 'driftwood-isle');
  if (home === undefined) throw new Error('Phone route needs unambiguous Driftwood/Night Market cells and lattice');
  const markets = state.cells.filter(row => row.slug === 'open-plot-night-market' && row.cell[0] === home.cell[0] - 1 && row.cell[1] === home.cell[1] + 1);
  const market = markets[0];
  if (markets.length !== 1 || market === undefined || !Number.isFinite(state.pitch) || state.pitch <= 500) throw new Error('Phone route needs unambiguous Driftwood/Night Market cells and lattice');
  const origin = { x: home.cell[0] * state.pitch, z: home.cell[1] * state.pitch };
  const target = { x: market.cell[0] * state.pitch, z: market.cell[1] * state.pitch };
  if (market.cell[1] !== home.cell[1] + 1) throw new Error('Night Market route south road no longer matches its declared cell');
  // The cold spawn is on the south beach. Leave through its south socket,
  // then follow the west perimeter road instead of walking through town walls.
  const road = { x: origin.x, z: origin.z - state.pitch / 2 };
  const southwestRoad = { x: origin.x - state.pitch / 2, z: road.z };
  const northwestRoad = { x: southwestRoad.x, z: origin.z + state.pitch / 2 };
  // Road kerbs open only at the shard edge midpoint (roadLayout G93).
  // Enter there before the wall probe, rather than aiming at a room through a kerb.
  const marketRoad = { x: target.x, z: target.z - state.pitch / 2 };
  // c27ec452e8's three-bay gate is centred on the plot. The avenue at
  // x=0 reaches its open central bay; the stone plinth faces block west/east.
  const wallStart = { x: target.x, z: target.z };
  /** @type {import('../frame-floor-grid.mjs').FloorGridPlan[]} */
  const plans = [
    { name: 'phone-driftwood-road', from: home.instance, to: null, movement: 'road-hover', waypoints: [road], requiredResidents: [] },
    { name: 'phone-road-night-market', from: null, to: market.instance, movement: 'road-hover', waypoints: [southwestRoad, northwestRoad, marketRoad, wallStart], requiredResidents: [market.instance] },
    { name: 'phone-night-market-road', from: market.instance, to: null, movement: 'road-hover', waypoints: [wallStart, marketRoad, northwestRoad, southwestRoad, road], requiredResidents: [] },
    { name: 'phone-road-driftwood-return', from: null, to: home.instance, movement: 'road-hover', waypoints: [{ x: origin.x, z: origin.z - 242.5 }], requiredResidents: [home.instance] },
  ];
  // This is a functional journey, not the slow frame-floor drive. Use the
  // existing bounded road allowance; the driver still clamps to the real
  // board's own limit and slows for each waypoint. Walking stays unchanged.
  for (const plan of plans) plan.hoverMaxSpeed = 30;
  return { market: market.instance, plans };
}

/** Exact clocks and substantive gates are separate from report-only rollout policy.
 * @param {import('./phone-route.mjs').PhoneReceipt} receipt */
export function phoneRouteFailures(receipt) {
  const failures = [];
  const [prefix = ''] = receipt.version.build.split('-');
  if (receipt.protocol !== (receipt.route === 'entry' ? 'jake-phone-route/2' : 'jake-phone-route/1') || !/^[a-f0-9]{40}$/u.test(receipt.sha) || !/^[a-f0-9]{7,40}$/u.test(prefix) || !receipt.sha.startsWith(prefix)) failures.push('Exact build SHA differs');
  if (receipt.paint.heroMs === null || !Number.isFinite(receipt.paint.heroMs) || receipt.paint.heroMs < 0 || receipt.paint.heroMs > 500) failures.push('Title hero first paint exceeds 500 ms or is unavailable');
  const expectedSteps = `title|SHARD SELECT|grid|Driftwood|road|Night Market${receipt.route === 'entry' ? '' : '|road return|Driftwood return'}`;
  if (receipt.steps.join('|') !== expectedSteps) failures.push('Incomplete phone route');
  const entry = receipt.entry;
  // The far view masks only refined regions; it legitimately remains visible
  // over the rest of the cell. Entered fine tiles, not whole-proxy absence,
  // distinguish a real near entry from a proxy-only view (farView.mask).
  if (entry === null || entry.cell?.slug !== 'open-plot-night-market' || entry.current !== entry.cell?.instance || entry.inside !== entry.cell?.instance || entry.ready !== true || entry.cell.shows !== 'playing' || !Number.isSafeInteger(entry.cell.drawn.l0) || entry.cell.drawn.l0 <= 0 || !Number.isSafeInteger(entry.cell.drawn.l1) || entry.cell.drawn.l1 < 0) failures.push('Night Market near tiles absent on first geometric entry');
  const wall = receipt.wall;
  const along = (/** @type {{x:number,z:number}} */ point) => wall===null ? 0 : (point.x-wall.from.x)*wall.direction.x+(point.z-wall.from.z)*wall.direction.z;
  if (wall === null || !Number.isFinite(wall.wallDistance) || wall.wallDistance < 1 || wall.wallDistance > 25 || !Number.isFinite(wall.collider) || wall.material==='edge' || wall.material==='' || wall.surface.width<2 || wall.surface.height<1.2 || !Object.values(wall.surface.normal).every(Number.isFinite) || Math.abs(wall.surface.normal.y)>.2 || Math.hypot(wall.direction.x,wall.direction.z)!==1 || !Number.isFinite(wall.elapsedMs) || wall.elapsedMs<3950 || wall.finalFrame - wall.startedFrame < 10 || !wall.hover || wall.samples.length < 10 || wall.samples.some(row => !row.hover || !Number.isFinite(along(row)) || along(row) >= wall.wallDistance - .1)) failures.push('Board did not remain blocked outside the real wall');
  if (wall !== null) {
    const tail = wall.samples.filter(row => row.ms >= wall.elapsedMs - 1000);
    if (along(wall.final) < 1 || tail.length < 2 || Math.max(...tail.map(along)) - Math.min(...tail.map(along)) > .15) failures.push('Board wall contact did not settle after actual forward movement');
  }
  if (receipt.fps.length !== 3 || receipt.fps.some(row => !Number.isFinite(row.elapsedMs) || !Number.isSafeInteger(row.frames) || row.elapsedMs < 9500 || row.frames <= 0 || Math.round(row.frames * 1000 / row.elapsedMs) < 30 || !Number.isFinite(row.pillFps) || row.pillFps <= 0 || !Number.isFinite(row.worstMs) || row.worstMs <= 0)) failures.push('G718 completed draws per wall-clock second below 30 fps or pill unavailable');
  if (receipt.observations.length < 5 || receipt.observations.some(row => !row.frameAvailable || row.grain !== 0 || row.contextLost || row.fatal.length > 0)) failures.push('Full-screen grain, lost context or fatal route state');
  if (receipt.frames.length < 6 || receipt.frames.some(row => row.darkShare >= .9 || row.width <= 0 || row.height <= row.width)) failures.push('Missing/black route capture');
  if (receipt.faults.length > 0) failures.push(...receipt.faults);
  return failures;
}

/** @param {import('./phone-route.mjs').PhonePage} page @param {string|(()=>()=>boolean)} expression @param {string} label @param {number} deadline */
export async function waitPhoneCondition(page, expression, label, deadline) {
  // One in-page condition subscription instead of repeated Inspector round trips.
  const condition=typeof expression==='string'?`()=>(${expression})`:`(${expression.toString()})()`;
  await page.evaluate(`(async()=>{
    const deadline=performance.now()+${Math.max(0,deadline-Date.now())};
    const ready=${condition};
    while(!ready()) {
      if(performance.now()>=deadline)throw new Error(${JSON.stringify(`Phone route deadline: ${label}`)});
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    return true;
  })()`);
  if (page.faults.length > 0) throw new Error(page.faults.join('\n'));
}

/** @param {import('./phone-route.mjs').PhonePage} page @param {string} out @param {string} label */
async function capture(page, out, label) {
  const bytes = await page.screenshot(join(out, `${label.replaceAll(' ', '-')}.png`));
  const metadata = await sharp(bytes).metadata();
  const { data } = await sharp(bytes).resize({ width: 192 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let dark = 0, pixels = 0;
  for (let at = 0; at < data.length; at += 16) { pixels++; if (Math.max(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0) < 16) dark++; }
  return { label, width: metadata.width ?? 0, height: metadata.height ?? 0, darkShare: dark / pixels };
}

/** The real title action navigates. Reattach only to that visit's new exact document before polling gameplay.
 * @param {Pick<import('./phone-route.mjs').PhonePage,'evaluate'|'click'|'followNavigation'>} page @param {string} url @param {number} deadline */
export async function enterPhoneGrid(page,url,deadline) {
  const prior = await page.evaluate('({url:location.href,visit:window.__phoneRouteVisit,document:window.__phoneRouteDocument,boot:window.__phoneRouteBootURL})');
  if (typeof prior !== 'object' || prior === null || !('url' in prior) || typeof prior.url !== 'string'
    || !('visit' in prior) || typeof prior.visit !== 'string' || !('document' in prior) || typeof prior.document !== 'string'
    || !('boot' in prior) || typeof prior.boot !== 'string') throw new Error('Phone route has no owned title document');
  await page.click('.ws-main-grid');
  await page.followNavigation(url,{url:prior.url,visit:prior.visit,document:prior.document,boot:prior.boot},deadline);
}

/** Diagnostics may fail synchronously (simctl) or asynchronously without replacing the primary route refusal.
 * @param {Pick<import('./phone-route.mjs').PhonePage,'screenshot'>} page @param {string} path */
export async function capturePhoneFailure(page,path) {
  try { await page.screenshot(path); } catch { /* the retained route failure remains primary */ }
}

/** @param {import('./phone-route.mjs').PhonePage} page @param {string} label */
async function fpsWindow(page, label) {
  // G718's own completed draw clock; a freeze contributes its full wall time.
  return /** @type {import('./phone-route.mjs').PhoneFps} */ (await page.evaluate(`(async()=>{
    const game=window.__wildshard.requireWorld().game, start=performance.now(), first=game.frameCount;
    let previous=start,worst=0; const stop=game.watchFrames(()=>{const now=performance.now();worst=Math.max(worst,now-previous);previous=now;});
    try{await new Promise(resolve=>setTimeout(resolve,10000));return {label:${JSON.stringify(label)},elapsedMs:performance.now()-start,frames:game.frameCount-first,worstMs:Math.max(worst,performance.now()-previous),pillFps:Number(document.querySelector('.ws-perf > b')?.textContent),pill:document.querySelector('.ws-perf')?.textContent??null};}finally{stop();}
  })()`));
}

/** @param {import('./phone-route.mjs').PhonePage} page @param {string} base @param {string} sha @param {string} out @param {'full'|'entry'} [route] */
export async function phoneRoute(page, base, sha, out, route = 'full') {
  const versionResponse = await fetch(new URL('/version.json', base));
  const version = /** @type {{build:string}} */ (await versionResponse.json());
  /** @type {import('./phone-route.mjs').PhoneReceipt} */
  const receipt = { protocol: route === 'entry' ? 'jake-phone-route/2' : 'jake-phone-route/1', route, rollout: process.env.PHONE_ROUTE_MODE ?? 'local-driver', sha, version, engine: page.engine, steps: [], paint: { heroMs: null, fcpMs: null, heroURL: null }, entry: null, wall: null, fps: [], observations: [], frames: [], faults: page.faults, routes: [], failures: [] };
  const observe = async () => {
    const state = /** @type {import('./phone-route.mjs').PhoneObservation|null} */ (await page.evaluate(`(${phoneRouteObservation.toString()})()`));
    if (state === null) throw new Error('Phone route lost the game');
    receipt.observations.push(state); return state;
  };
  const shot = async (/** @type {string} */ label) => {
    receipt.frames.push(await capture(page, out, label));
    writeFileSync(join(out, 'phone-route.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`phone-route stage ${label}`);
  };
  try {
    const url = new URL(base);
    for (const [key, value] of Object.entries({ tier: 'phone', touch: '1', mute: '1', nolock: '1', sw: '0' })) url.searchParams.set(key, value);
    const titleDeadline=Date.now()+60000;
    await page.cold(url.href, `(${installPhoneTitlePaint.toString()})(${JSON.stringify(url.href)})`);
    await waitPhoneCondition(page, `document.querySelector('.ws-main-select')!==null && (()=>{const load=document.querySelector('.ws-load');return load===null||getComputedStyle(load).display==='none'||getComputedStyle(load).visibility==='hidden'||getComputedStyle(load).opacity==='0';})()`, 'title', titleDeadline);
    // The shell can hydrate before the image-load/rAF witness publishes.
    // Await that FIRST recorded paint under the same deadline; never resample it.
    await waitPhoneCondition(page,'window.__phoneRoutePaint?.heroMs!==null && window.__phoneRoutePaint?.heroMs!==undefined','first title paint witness',titleDeadline);
    receipt.paint = /** @type {typeof receipt.paint} */ (await page.evaluate('window.__phoneRoutePaint'));
    receipt.steps.push('title'); await shot('title');
    await page.click('.ws-main-select');
    // MP2.4: a fresh device's first PLAY asks its Name first; Skip keeps the default and SHARD SELECT opens
    await waitPhoneCondition(page, `(document.querySelector('#ws-name-box [data-name=skip]')?.click(), document.querySelector('.ws-menu:not(.hide)')!==null)`, 'SHARD SELECT', Date.now() + 10000);
    receipt.steps.push('SHARD SELECT'); await shot('SHARD SELECT'); await page.click('.ws-menu-back');
    const gridDeadline = Date.now()+60000, gridURL = new URL(base); gridURL.search=''; gridURL.hash='';
    await enterPhoneGrid(page,gridURL.href,gridDeadline);
    await waitPhoneCondition(page, phoneGridEntryCondition, 'grid Driftwood entry', gridDeadline);
    receipt.boot = await page.evaluate(`(${phoneLoadingObservation.toString()})()`);
    receipt.steps.push('grid', 'Driftwood'); await observe(); await shot('Driftwood'); receipt.fps.push(await fpsWindow(page, 'Driftwood'));
    const initial = await observe(), { market, plans } = phoneRoutePlans(initial);
    const identity = /** @type {import('../frame-floor-grid.mjs').FloorGridDocumentIdentity} */ (await page.evaluate(`(${gridFloorDocumentIdentity.toString()})()`));
    await page.evaluate(`(${watchPhoneEntry.toString()})(${JSON.stringify(market)})`);
    for (const [index, plan] of (route === 'entry' ? plans.slice(0,2) : plans).entries()) {
      // No plan has a start/pose: every crossing and the return uses held input.
      const witness = await runFloorGridRoute(page, plan, identity);
      receipt.routes.push(witness);
      const failures = gridFloorWitnessFailures(witness);
      if (failures.length > 0) throw new Error(failures.join('; '));
      receipt.steps.push(['road', 'Night Market', 'road return', 'Driftwood return'][index] ?? 'invalid');
      await observe(); await shot(plan.name);
      if (index === 0) receipt.fps.push(await fpsWindow(page, 'road'));
      if (index === 1) {
        receipt.entry = /** @type {import('./phone-route.mjs').PhoneReceipt['entry']} */ (await page.evaluate('window.__phoneRouteEntry?.entry??null'));
        receipt.fps.push(await fpsWindow(page, 'Night Market'));
        const wallTarget=/** @type {import('./phone-route.mjs').PhoneWallTarget} */ (await page.evaluate(`(${phoneWallTarget.toString()})()`));
        const approach=await runFloorGridRoute(page,{name:'phone-wall-approach',from:market,to:market,movement:'road-hover',waypoints:[wallTarget.approach],requiredResidents:[market]},identity);
        receipt.routes.push(approach);
        const approachFailures=gridFloorWitnessFailures(approach);if(approachFailures.length>0)throw new Error(approachFailures.join('; '));
        await page.click('.ws-touch-hover');
        await waitPhoneCondition(page, 'window.__wildshard.requireWorld().player.hover===true', 'actual touch HOVER', Date.now()+5000);
        receipt.wall = /** @type {import('./phone-route.mjs').PhoneWall} */ (await page.evaluate(`(${phoneBoardWall.toString()})(4000,${JSON.stringify(wallTarget)})`));
        await observe(); await shot('board-wall');
      }
    }
    receipt.failures = phoneRouteFailures(receipt);
  } catch (error) {
    receipt.failures.push(String(error));
    receipt.stop = await page.evaluate(`(()=>{const loading=(${phoneLoadingObservation.toString()})();const api=window.__wildshard,grid=api?.shard.grid;if(!grid||typeof grid.state!=='function')return {loading};const state=grid.state();return {loading,entryCondition:{at:performance.now(),home:state.home,inside:state.inside,worldPresent:api.world!==undefined,frameGate:api.world?.game.frameGate()??null,visibility:document.visibilityState},drive:window.__frameFloorGridStop??null,ringsReady:state.ringsReady,ringsWait:state.ringsWait,crossing:state.live?.crossing,live:state.live?.live};})()`).catch((/** @type {unknown} */ diagnosticError) => ({ unavailable: String(diagnosticError) }));
    await capturePhoneFailure(page,join(out, 'phone-route-failure.jpg'));
  } finally { writeFileSync(join(out, 'phone-route.json'), `${JSON.stringify(receipt, null, 2)}\n`); }
  if (receipt.failures.length > 0) throw new Error(receipt.failures.join('\n'));
  return receipt;
}

async function main() {
  const option = (/** @type {string} */ key) => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
  const out = resolvePath(option('out') ?? 'boot-smoke-results/phone-route'); mkdirSync(out, { recursive: true });
  const sha = option('sha') ?? process.env.TESTED_SHA;
  if (sha === undefined || !/^[a-f0-9]{40}$/u.test(sha)) throw new Error('Phone route requires exact --sha');
  const route = option('route') ?? 'full';
  if (route !== 'full' && route !== 'entry') throw new Error('Unknown phone route');
  const external = option('url'), preview = external === undefined ? await serve(resolvePath('../parity'), '', true) : null;
  const base = external ?? preview?.url;
  if (base === undefined) throw new Error('Missing phone route preview');
  const page = await openPhoneBrowser(option('engine') ?? 'webkit', base, out);
  try { await phoneRoute(page, base, sha, out, route); } finally { try { await page.close(); } finally { preview?.close(); } }
}
if (process.argv[1] && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url) await main();
