// J476 smoke: real gates into the eight featured shards. J451's full route stays available by hand.
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptPhoneMemoryWarning, deployFrameProblem, PHONE } from './journey-proof.mjs';
import { saveFixture } from './debug-settings.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';
import featured from '../src/server/game/zoneSelect/featured.json' with { type: 'json' };

/** @typedef {{instance:string, slug?:string, cell:readonly [number,number]}} Cell */
/** @typedef {{from:Cell, to:Cell}} Leg */
/** @typedef {{from:string,to:string}} Pair */
/** @typedef {{from:string,to:string,ms:number}} Arrival */
/** @typedef {Pair & {reason:string}} CrossingFailure */
/** @typedef {{expected:number, arrivals:Arrival[], failure?:CrossingFailure, retries?:CrossingFailure[], resumedFrom?:number, pass:boolean}} Tour */
/** @typedef {Arrival & {index:number}} SmokeArrival */
/** @typedef {CrossingFailure & {index:number}} SmokeFailure */
/** @typedef {{mode:'smoke', build:string, engine:'webkit', profile:'phone', seed:number, cells: Cell[], expected:number,
 * arrivals:SmokeArrival[], failures:SmokeFailure[], failure?:CrossingFailure, pass:boolean, wallMs:number}} SmokeReport */
const SIDES = /** @type {const} */ ([[1, 0], [0, 1], [-1, 0], [0, -1]]);
const DRIFTWOOD = 'driftwood-isle', SKY = 'far-reach', HALF = 250, ENTRY_MS = 90_000, APPROACH_MS = 120_000;
const STAGING = 'https://staging.wildshard.io';
export const FIRST_ZONE_PAIR = Object.freeze({from: DRIFTWOOD, to: SKY});

/** @param {number} seed */
function validSeed(seed) {
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff;
}

/** Choose two distinct approaches where a featured shard has two neighbours.
 * A shard with one gate uses it twice. Record each crossing by its route index.
 * @param {readonly Cell[]} cells @param {number} seed @returns {Leg[]} */
export function featuredZoneEntry(cells, seed) {
  if (!validSeed(seed)) throw new Error('--seed must be an unsigned 32-bit integer');
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  /** @template T @param {T[]} rows */
  const shuffle = rows => {
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1)), a = rows[i], b = rows[j];
      if (a !== undefined && b !== undefined) { rows[i] = b; rows[j] = a; }
    }
    return rows;
  };
  const ids = new Set(cells.map(cell => cell.instance)), spots = new Map(cells.map(cell => [cell.cell.join(','), cell]));
  if (ids.size !== cells.length || spots.size !== cells.length ||
      cells.some(cell => typeof cell.instance !== 'string' || cell.cell.length !== 2 ||
        cell.cell.some(at => !Number.isInteger(at) || Math.abs(at) > 3))) throw new Error('Invalid live smoke grid');
  if (featured.length !== 8 || new Set(featured).size !== 8) throw new Error('Zone Select must name eight featured shards');
  return shuffle(featured.flatMap(slug => {
    const matches = cells.filter(cell => (cell.slug ?? cell.instance) === slug), to = matches[0];
    if (to === undefined || matches.length !== 1) throw new Error(`Duplicate or missing featured shard in live grid: ${slug}`);
    const neighbours = shuffle(SIDES.map(([dx,dz]) => spots.get(`${to.cell[0]+dx},${to.cell[1]+dz}`)).filter(from => from !== undefined));
    const first = neighbours[0];
    if (first === undefined) throw new Error(`No live gate into featured shard ${slug}`);
    return [{from:first,to}, {from:neighbours[1] ?? first,to}];
  }));
}

/** @param {readonly number[]} pending @returns {number[][]} */
export function smokeBatches(pending) {
  if (pending.length === 16) return [pending.slice(0,5), pending.slice(5,10), pending.slice(10)];
  return [0,1,2].map(lane => pending.filter((_,index) => index%3 === lane));
}

/** @param {readonly Leg[]} route @param {Partial<SmokeReport>} proof */
function smokeEntries(route, proof) {
  if (proof.expected !== route.length || !Array.isArray(proof.arrivals) || !Array.isArray(proof.failures))
    throw new Error('The verdict lacks the complete set of smoke pairs');
  if (proof.arrivals.some(row => !Number.isFinite(row?.ms) || row.ms <= 0) ||
      proof.failures.some(row => typeof row?.reason !== 'string' || row.reason.length === 0))
    throw new Error('The verdict has an invalid smoke pair result');
  const seen = new Set();
  for (const row of [...proof.arrivals, ...proof.failures]) {
    const pair = route[row?.index];
    if (!Number.isSafeInteger(row?.index) || pair === undefined || seen.has(row.index) ||
        row.from !== pair.from.instance || row.to !== pair.to.instance)
      throw new Error('The verdict has an invalid or duplicate smoke pair');
    seen.add(row.index);
  }
  if (seen.size !== route.length) throw new Error('The verdict does not account for every smoke pair');
}

/** @param {readonly Leg[]} route @param {unknown} report @param {string} build @param {number} seed */
export function retrySmokeEntries(route, report, build, seed) {
  const proof = /** @type {SmokeReport|null} */ (report);
  if (proof?.mode !== 'smoke' || proof.build !== build || proof.engine !== 'webkit' || proof.profile !== 'phone' || proof.pass !== false)
    throw new Error('Retry needs a held phone WebKit smoke for the same staging build');
  if (proof.seed !== seed) throw new Error('Retry must use the saved seed');
  smokeEntries(route, proof);
  if (proof.failures.length === 0) throw new Error('The held verdict has no failed pairs to retry');
  return {arrivals:[...proof.arrivals], pending:proof.failures.map(row => row.index).sort((a,b) => a-b)};
}

/** @param {unknown} report */
export function smokeGap(report) {
  const proof = /** @type {SmokeReport} */ (report);
  try {
    const route = featuredZoneEntry(proof.cells, proof.seed);
    smokeEntries(route, proof);
    if (proof.pass === true && proof.failures.length === 0 && proof.arrivals.length === 16) return undefined;
  } catch { /* Only a complete, matching smoke qualifies a release. */ }
  return 'J476 zone-entry smoke did not pass all 16 seeded crossings';
}

/** Walk each shared side in both directions. Every leg starts where the previous one ended.
 * @param {readonly Cell[]} cells @returns {Leg[]} */
export function zoneEntryTour(cells) {
  const at = new Map(cells.map(cell => [cell.cell.join(','), cell]));
  const home = cells.find(cell => cell.instance === DRIFTWOOD);
  const sky = cells.find(cell => cell.instance === SKY);
  if (home === undefined || sky === undefined ||
      Math.abs(home.cell[0]-sky.cell[0])+Math.abs(home.cell[1]-sky.cell[1]) !== 1) {
    throw new Error('Driftwood and Sky Reach have no shared side in the live grid');
  }
  /** @type {Leg[]} */ const route = [];
  /** @type {Set<string>} */ const visited = new Set();
  /** @type {Set<string>} */ const reached = new Set();
  /** @param {Cell} from */
  function visit(from) {
    reached.add(from.instance);
    const next = SIDES.map(([dx, dz]) => at.get([from.cell[0]+dx, from.cell[1]+dz].join(',')))
      .filter(to => to !== undefined);
    if (from === home) next.sort((a, b) => Number(b === sky)-Number(a === sky));
    for (const to of next) {
      const side = [from.instance, to.instance].sort().join('/');
      if (visited.has(side)) continue;
      visited.add(side);
      route.push({from, to});
      visit(to);
      route.push({from: to, to: from});
    }
  }
  visit(home);
  if (reached.size !== cells.length) throw new Error('The live grid has cells outside the walking tour');
  return route;
}

/** Keep a reported prefix only when the same phone build and the current live route agree with it.
 * @param {readonly Leg[]} route @param {unknown} proof @param {string} build @param {number} from */
export function resumeZoneEntry(route, proof, build, from) {
  const prior = /** @type {Partial<Tour> & {build?:string, engine?:string, profile?:string} | null} */ (proof);
  if (prior?.build !== build || prior.engine !== 'webkit' || prior.profile !== 'phone' || prior.pass !== false) {
    throw new Error('Resume needs a held phone WebKit proof for the same staging build');
  }
  if (!Array.isArray(prior.arrivals) || !Number.isSafeInteger(from) || from < 1 || from > route.length || prior.arrivals.length !== from-1) {
    throw new Error('Resume must start at the next crossing after the saved prefix');
  }
  /** @param {Pair | undefined} pair @param {Leg | undefined} leg */
  const matches = (pair, leg) => typeof pair === 'object' && pair !== null && leg !== undefined &&
    pair.from === leg.from.instance && pair.to === leg.to.instance;
  if (prior.expected !== route.length || !matches(prior.failure, route[from-1]) ||
      !prior.arrivals.every((arrival, index) => matches(arrival, route[index]) && Number.isFinite(arrival.ms) && arrival.ms > 0)) {
    throw new Error('The saved prefix does not match the live route');
  }
  return [...prior.arrivals];
}

/** @template T @param {(attempt:1 | 2) => Promise<T | undefined>} run */
export async function retryZoneEntry(run) {
  const first = await run(1);
  return first === undefined ? undefined : run(2);
}

/** The shortest route already played to the source of a held crossing.
 * @param {readonly Leg[]} qualified @param {string} home @param {string} destination @returns {Leg[]} */
export function zoneEntryCorridor(qualified, home, destination) {
  /** @type {{at:string, legs:Leg[]}[]} */
  const pending = [{at:home, legs:[]}];
  const seen = new Set([home]);
  for (const {at, legs} of pending) {
    if (at === destination) return legs;
    for (const leg of qualified) {
      if (leg.from.instance !== at || seen.has(leg.to.instance)) continue;
      seen.add(leg.to.instance);
      pending.push({at:leg.to.instance, legs:[...legs, leg]});
    }
  }
  throw new Error('No completed route reaches the held crossing source');
}

/** @typedef {{x:number,z:number}} Point */
/** @typedef {Point & {ride:boolean}} ApproachPoint */
/** @typedef {readonly [number,number,number]} PortalPoint */
/** @typedef {{road:{at:PortalPoint},route:readonly PortalPoint[]}} PortalExit */
/** @typedef {import('playwright').Page} Page */
/** @param {Page} page */
const feet = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), st = w.__wildshard?.shard?.grid?.state?.();
  if (st === undefined || w.__wildshard?.world?.player === undefined) return null;
  return {x: Number(st.feet.x), z: Number(st.feet.z), home: String(st.home)};
});

/** @param {Page} page @param {Point} from @param {Point} toward */
const face = (page, from, toward) => page.evaluate(yaw => {
  /** @type {any} */ (window).__wildshard.world.player.yaw = yaw;
}, Math.atan2(from.x-toward.x, from.z-toward.z));

// A bad approach and a stalled destination both use the entry timer. Keep the last scene state.
/** @param {Page} page */
function crossingDetail(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.ws-load [data-el="foot"]'));
    const visible = rows.find(row => row.getClientRects().length > 0);
    const st = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.();
    const loading = String(visible?.textContent?.trim() ?? st?.cellStep?.step ?? '').replaceAll(/\s+/gu, ' ').slice(0, 150);
    const here = st?.feet;
    const position = here === undefined ? '' : `, feet ${Number(here.x).toFixed(1)}, ${Number(here.z).toFixed(1)}`;
    const grid = st === undefined ? '' : `home ${String(st.home ?? 'none')}, gate ${String(st.gate?.cell ?? 'none')}${position}`;
    return [grid, loading].filter(Boolean).join('; ');
  }).catch(() => '');
}

/** @param {number} ms @param {() => Promise<void>} run @param {string} message */
async function bounded(ms, run, message) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
  const time = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  try { await Promise.race([time, run()]); } finally { clearTimeout(timer); }
}

/** Travel by input. Reading feet and setting the heading leaves the online seat under the server's control.
 * @param {Page} page @param {Point} target @param {number} end
 * @param {{sprint?:boolean, arriving?:string, within?:number, landed?:(here:Point)=>boolean}} [options] */
async function walk(page, target, end, {sprint = false, arriving, within = sprint ? 1.5 : 0.4, landed} = {}) {
  /** @type {Point | null} */ let last = null;
  let movedAt = Date.now();
  if (sprint) await page.keyboard.down('ShiftLeft');
  try {
    while (Date.now() < end) {
      const here = await feet(page).catch(() => null);
      if (here === null) { await delay(150); continue; }
      const distance = Math.hypot(here.x-target.x, here.z-target.z);
      if (here.home === arriving || distance <= within || landed?.(here) === true) return;
      await face(page, here, target);
      await page.keyboard.down('KeyW');
      if (last === null || Math.hypot(last.x-here.x, last.z-here.z) >= 0.5) {
        last = here;
        movedAt = Date.now();
      } else if (sprint && Date.now()-movedAt > 1200) {
        await page.keyboard.press('Space');
        movedAt = Date.now();
      }
      await delay(Math.min(250, Math.max(65, distance*140)));
    }
    throw new Error('The walker did not reach the gate approach');
  } finally {
    await page.keyboard.up('KeyW');
    if (sprint) await page.keyboard.up('ShiftLeft');
  }
}

/** Toggle the normal board control and wait for the motor to acknowledge it.
 * @param {Page} page @param {boolean} enabled */
async function board(page, enabled) {
  await page.keyboard.press('KeyH');
  await page.waitForFunction(on => /** @type {any} */ (window).__wildshard?.world?.player?.hover === on,
    enabled, { timeout: 5000, polling: 100 });
}

/** Ride only along the boulevards. Walk the turn-ins and stop on foot before aiming at a gate.
 * @param {Page} page @param {ApproachPoint} point @param {number} end */
async function approachPoint(page, point, end) {
  if (point.ride) {
    await board(page, true);
    try {
      await walk(page, point, end, {within: 18});
    } finally {
      await board(page, false);
    }
  }
  await walk(page, point, end, {sprint: true});
}

/** Convert the published square route and its possible road landings to grid metres.
 * @param {readonly PortalExit[]} entries @param {Point} center @param {Point} incoming */
export function portalExitPlan(entries, center, incoming) {
  const decks = entries.map(({road:{at:[x, , z]}}) => {
    const [dx, dz] = Math.abs(x) > Math.abs(z) ? [Math.sign(x), 0] : [0, Math.sign(z)];
    return {x:center.x+x, z:center.z+z, dx, dz};
  });
  const entry = entries[decks.findIndex(deck => deck.dx === incoming.x && deck.dz === incoming.z)];
  return entry === undefined ? null : {walk:entry.route.map(([x, , z]) => ({x:center.x+x,z:center.z+z})), decks};
}

/** The same content set the served page reads. Portal routes are optional product data.
 * @param {Page} page @param {string} slug @returns {Promise<PortalExit[]>} */
async function portalExits(page, slug) {
  const path = await page.evaluate(slug_ => {
    const bank = JSON.parse(document.getElementById('boot-module-files')?.textContent ?? '{}');
    const home = bank.spawnManifests?.home, baked = home?.shards?.includes(slug_);
    const content = bank.contentBase;
    const origin = typeof content === 'string' && content.length > 0 ? content : document.baseURI;
    const base = new URL(baked ? home.base : origin);
    const loose = baked ? home.loose?.[slug_] : undefined;
    const root = typeof loose === 'string' && /^loose\/[a-f0-9]{64}\/$/u.test(loose) ? new URL(loose, base) : base;
    return new URL(`shardfiles/${encodeURIComponent(slug_)}/sections/world/edge.json`, root).href;
  }, slug);
  const address = new URL(path);
  if (!['https://packs.wildshard.io', 'https://staging.wildshard.io'].includes(address.origin)) throw new Error('Unexpected portal data origin');
  const response = await fetch(address, {signal: AbortSignal.timeout(10_000)});
  if (!response.ok) throw new Error(`Could not read the portal rows (HTTP ${response.status})`);
  const edge = /** @type {{entryways?: {portal?:PortalExit}[]}} */ (await response.json());
  return (edge.entryways ?? []).flatMap(row => row.portal === undefined ? [] : [row.portal]);
}

/** A portal can carry the walker inside immediately after a gate. Walk the declared exit first.
 * @param {Page} page @param {Cell} from @param {Cell} last @param {Point} center @param {number} end @returns {Promise<Cell>} */
async function exitToRoad(page, from, last, center, end) {
  const at = await feet(page);
  if (at === null || Math.max(Math.abs(at.x-center.x), Math.abs(at.z-center.z)) >= HALF-30) return last;
  const plan = portalExitPlan(await portalExits(page, from.slug ?? from.instance), center,
    {x:last.cell[0]-from.cell[0], z:last.cell[1]-from.cell[1]});
  if (plan === null || plan.walk.length === 0) throw new Error('The gate seated the walker inland without a declared portal exit');
  /** @param {Point} point */
  const onDeck = point => plan.decks.some(deck => Math.hypot(point.x-deck.x, point.z-deck.z) < 5);
  for (const point of plan.walk) await walk(page, point, end, {landed: onDeck});
  await page.waitForFunction(decks => {
    const st = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.();
    return st !== undefined && decks.some(deck => Math.hypot(st.feet.x-deck.x, st.feet.z-deck.z) < 5);
  }, plan.decks, {timeout: Math.min(10_000, Math.max(1, end-Date.now())), polling: 150});
  const out = await feet(page);
  const deck = out === null ? undefined : plan.decks.find(row => Math.hypot(out.x-row.x, out.z-row.z) < 5);
  if (deck === undefined) throw new Error('The portal did not leave the walker on a declared deck');
  return {instance:from.instance, cell:[from.cell[0]+deck.dx, from.cell[1]+deck.dz]};
}

/** Stay on the public road around the current cell when changing exit sides.
 * @param {Cell} last @param {Leg} leg @param {Point} center @param {number} pitch @returns {ApproachPoint[]} */
export function roadApproach(last, leg, center, pitch) {
  const incoming = SIDES.findIndex(([dx, dz]) => last.cell[0]-leg.from.cell[0] === dx && last.cell[1]-leg.from.cell[1] === dz);
  const outgoing = SIDES.findIndex(([dx, dz]) => leg.to.cell[0]-leg.from.cell[0] === dx && leg.to.cell[1]-leg.from.cell[1] === dz);
  const sign = (outgoing-incoming+SIDES.length)%SIDES.length <= 2 ? 1 : -1;
  /** @param {number} side */
  const road = side => {
    const [x, z] = SIDES[(side+SIDES.length)%SIDES.length] ?? [0, 0];
    return {x: x*pitch/2, z: z*pitch/2};
  };
  const first = road(incoming);
  const points = [{x: center.x+first.x, z: center.z+first.z, ride: false}];
  for (let side = incoming; side !== outgoing;) {
    const before = road(side);
    side = (side+sign+SIDES.length)%SIDES.length;
    const after = road(side);
    points.push({x: center.x+before.x+after.x, z: center.z+before.z+after.z, ride: true},
      {x: center.x+after.x, z: center.z+after.z, ride: true});
  }
  return points;
}

/** @param {Page} page @param {string} target @param {Point} center @param {number} end */
async function arrived(page, target, center, end) {
  await page.waitForFunction(id => {
    const st = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.();
    return st?.home === id && st?.inside === id && st?.live?.live?.gameplayReady === true;
  }, target, {timeout: Math.max(1, end-Date.now()), polling: 200});
  let frame;
  do {
    if (await page.locator('#wserr:visible, .ws-fail:visible').count() > 0) throw new Error('An error card opened after crossing');
    frame = await deployFrameProblem(page);
    if (frame !== null) await delay(500);
  } while (frame !== null && Date.now()+1500 < end);
  if (frame !== null) throw new Error(frame);
  do {
    const before = await feet(page);
    if (before?.home === target) {
      await face(page, before, center);
      try { await page.keyboard.down('KeyW'); await delay(700); } finally { await page.keyboard.up('KeyW'); }
      const after = await feet(page);
      if (after?.home === target && Math.hypot(after.x-before.x, after.z-before.z) >= 0.25) return;
    }
    await delay(250);
  } while (Date.now()+1500 < end);
  throw new Error('Walk input did not move the player within the entry window');
}

/** @param {Page} page */
const gridLayout = page => page.evaluate(() => {
    const st = /** @type {any} */ (window).__wildshard.shard.grid.state();
    return /** @type {{cells: Cell[],pitch:number}} */ (st);
});

/** @param {Page} page @param {Leg} leg @param {Point} center @param {number} pitch @param {Cell} [previous] */
async function crossZoneEntry(page, leg, center, pitch, previous) {
  const {from, to} = leg;
  const dx = to.cell[0]-from.cell[0], dz = to.cell[1]-from.cell[1];
  const gate = {x:center.x+dx*(pitch-HALF+2), z:center.z+dz*(pitch-HALF+2)};
  const targetCenter = {x:center.x+dx*pitch, z:center.z+dz*pitch};
  const approachEnd = Date.now()+APPROACH_MS;
  await bounded(APPROACH_MS, async () => {
    const approach = previous === undefined
      ? [{x:center.x+dx*(HALF-15), z:center.z+dz*(HALF-15), ride:false}]
      : roadApproach(await exitToRoad(page, from, previous, center, approachEnd), leg, center, pitch);
    for (const point of approach) await approachPoint(page, point, approachEnd);
  }, 'The walker timed out on the gate approach');
  const started = Date.now();
  await bounded(ENTRY_MS, async () => {
    await walk(page, gate, started+ENTRY_MS, {arriving: to.instance});
    await arrived(page, to.instance, targetCenter, started+ENTRY_MS);
  }, 'The next world did not reach drawn, interactive play within 90 seconds');
  return Date.now()-started;
}

/** @param {Page} page @param {Point} origin @param {Tour} result @param {() => void} save
 * @param {{restart:()=>Promise<Page>, resume?:{proof:unknown, build:string, from:number}}} options */
export async function walkZoneEntryTour(page, origin, result, save, {restart, resume}) {
  const {cells, pitch} = await gridLayout(page);
  const route = zoneEntryTour(cells);
  result.expected = route.length;
  const start = route[0]?.from;
  if (start === undefined) throw new Error('The live grid contains no gate crossings');
  let walkingPage = page;
  const layoutId = (/** @type {readonly Cell[]} */ rows) => JSON.stringify([...rows]
    .sort((a, b) => a.instance.localeCompare(b.instance))
    .map(({instance,slug,cell}) => [instance,slug,cell]));
  const layout = layoutId(cells);
  const reboot = async () => {
    const reopened = await restart(), next = await gridLayout(reopened);
    if (next.pitch !== pitch || layoutId(next.cells) !== layout) {
      throw new Error('The live grid changed while restarting the tour');
    }
    return reopened;
  };
  /** @param {Page} crossingPage @param {Leg} leg @param {Cell | undefined} previous */
  const cross = async (crossingPage, leg, previous) => {
    const {from} = leg;
    const center = {x: origin.x+(from.cell[0]-start.cell[0])*pitch, z: origin.z+(from.cell[1]-start.cell[1])*pitch};
    return crossZoneEntry(crossingPage, leg, center, pitch, previous);
  };
  /** @param {Cell} destination */
  const position = async destination => {
    const corridor = zoneEntryCorridor(route.slice(0, result.arrivals.length), start.instance, destination.instance);
    /** @type {Cell | undefined} */ let last;
    for (const leg of corridor) {
      console.log(`POSITION ${leg.from.instance} -> ${leg.to.instance}`);
      await cross(walkingPage, leg, last);
      last = leg.from;
    }
    return last;
  };
  if (resume !== undefined) {
    result.arrivals = resumeZoneEntry(route, resume.proof, resume.build, resume.from);
    result.resumedFrom = resume.from;
  }
  let needsPositioning = resume !== undefined;
  /** @type {Cell | undefined} */ let previous;
  for (const leg of route.slice(result.arrivals.length)) {
    const {from, to} = leg, pair = {from: from.instance, to: to.instance};
    result.failure = {...pair, reason: 'The runner stopped during this crossing'};
    save();
    const failure = await retryZoneEntry(async attempt => {
      try {
        if (attempt === 2) { walkingPage = await reboot(); needsPositioning = true; }
        if (needsPositioning) previous = await position(from);
        result.arrivals.push({...pair, ms:await cross(walkingPage, leg, previous)});
        previous = from;
        needsPositioning = false;
        console.log(`PASS ${pair.from} -> ${pair.to}`);
        return undefined;
      } catch (error) {
        const detail = await Promise.race([crossingDetail(walkingPage), delay(2000, '')]);
        const reason = error instanceof Error ? error.message : String(error);
        const missed = {...pair, reason: `${reason.split('\n')[0]}${detail ? ` (${detail})` : ''}`};
        if (attempt === 1) {
          (result.retries ??= []).push(missed);
          console.log(`RETRY ${pair.from} -> ${pair.to}: ${missed.reason}`);
          save();
        }
        return missed;
      }
    });
    if (failure !== undefined) {
      result.failure = failure;
      return;
    }
  }
  delete result.failure;
  result.pass = true;
}

/** @param {string} build */
async function requireStagingBuild(build) {
  const response = await fetch(`${STAGING}/version.json`, {cache:'no-store', signal:AbortSignal.timeout(15_000)});
  if (!response.ok || (await response.json()).build !== build) throw new Error('Staging serves a different build from the zone-entry request');
}

/** Seat a normal guest at the source cell of an otherwise independent crossing.
 * @param {Page} page @param {Cell} source @param {string} build @param {string} name */
async function bootSmokeSource(page, source, build, name) {
  const url = new URL('/', STAGING);
  url.search = new URLSearchParams({chunk:source.slug ?? source.instance, mute:'1', nolock:'1', skipintro:'1', fps:'60'}).toString();
  await page.goto(url.href, {waitUntil:'domcontentloaded', timeout:45_000});
  const nameBox = page.locator('#ws-name-box input');
  const stop = Date.now()+90_000;
  while (Date.now() < stop) {
    const state = await page.evaluate(() => {
      const w = /** @type {any} */ (window), st = w.__wildshard?.shard?.grid?.state?.();
      const world = st?.live?.live;
      return {home:st?.home, ready:world?.gameplayReady === true, build:w.__WS_BUILD_ID__,
        error:document.querySelector('.ws-load-error')?.textContent?.trim() ?? ''};
    }).catch(() => null);
    if (state?.error) throw new Error(state.error.slice(0,240));
    if (state?.ready && state.home === source.instance && state.build === build) {
      await page.getByText('DONE', {exact:true}).click({timeout:800}).catch(() => undefined);
      return;
    }
    if (await nameBox.isVisible().catch(() => false)) {
      await nameBox.fill(name, {timeout:3000});
      await page.locator('#ws-name-box button[type=submit]').click({timeout:3000});
    } else await acceptPhoneMemoryWarning(page);
    await delay(400);
  }
  throw new Error(`The source ${source.instance} did not reach interactive play`);
}

/** @param {Page} page @param {Leg} leg */
async function smokePose(page, leg) {
  const {cells, pitch} = await gridLayout(page);
  const matches = (/** @type {Cell} */ cell) => cells.some(row => row.instance === cell.instance &&
    row.slug === cell.slug && row.cell[0] === cell.cell[0] && row.cell[1] === cell.cell[1]);
  if (!matches(leg.from) || !matches(leg.to)) throw new Error('The live grid changed for this pair');
  const center = await page.evaluate(() => {
    const w = /** @type {any} */ (window), g = w.__wildshard.shard.grid.state();
    const world = g.live.live.worldFeet, local = w.__wildshard.world.player.position;
    return {x:world.x-local.x, z:world.z-local.z};
  });
  return {center, pitch};
}

/** @param {{build:string, out:string, seed:number, prior?:unknown}} options */
async function runSmoke({build, out, seed, prior}) {
  const began = Date.now(), path = join(out, 'zone-entry.json');
  const {webkit} = await import('./browser-playwright.mjs');
  await requireStagingBuild(build);
  console.log(`J476 zone-entry seed ${seed}; exact build ${build}`);
  // Three independent guest sessions share one admitted headless WebKit owner.
  const browser = await webkit.launch({headless:true});
  try {
    const contexts = await Promise.all([0,1,2].map(async () => {
      const context = await browser.newContext({...PHONE,isMobile:true});
      await context.addInitScript(guardStagingSockets, 'wss://rooms-staging.wildshard.io');
      await saveFixture(context, {scope:'device',key:'firstPlayDone',data:true});
      await saveFixture(context, {scope:'device',key:'devMode',data:true});
      await saveFixture(context, {scope:'global',key:'settings',merge:true,data:{volume:0}});
      return context;
    }));
    /** @type {Cell[]} */ let cells;
    if (prior === undefined) {
      const discovery = await contexts[0]?.newPage();
      if (discovery === undefined) throw new Error('No phone smoke discovery session');
      try {
        await bootSmokeSource(discovery, {instance:DRIFTWOOD,cell:[0,0]}, build, `ZE ${began.toString(36).slice(-5)} G`);
        ({cells} = await gridLayout(discovery));
      } catch (error) {
        const detail = await Promise.race([crossingDetail(discovery),delay(2000,'')]);
        throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? ` (${detail})` : ''}`, {cause:error});
      } finally {
        await discovery.close();
      }
    } else {
      // New placement overlays can arrive between attempts. Keep the saved
      // draw and let each retried pair verify its live source and destination.
      cells = /** @type {SmokeReport} */ (prior).cells;
    }
    cells = cells.map(({instance,slug,cell}) => ({instance,...(slug === undefined ? {} : {slug}),cell}));
    const route = featuredZoneEntry(cells,seed);
    const {arrivals,pending} = prior === undefined
      ? {arrivals:[],pending:route.map((_,index) => index)}
      : retrySmokeEntries(route,prior,build,seed);
    /** @type {Map<number,SmokeFailure>} */ const failed = new Map();
    for (const index of pending) {
      const leg = route[index];
      if (leg !== undefined) failed.set(index,{index,from:leg.from.instance,to:leg.to.instance,reason:'Crossing did not finish'});
    }
    const save = (/** @type {boolean} */ checked = false) => {
      const failures = [...failed.values()].sort((a,b) => a.index-b.index), failure = failures[0];
      const pass = checked && failures.length === 0 && arrivals.length === route.length;
      /** @type {SmokeReport} */ const verdict = {mode:'smoke',seed,build,engine:'webkit',profile:'phone',cells,
        expected:route.length,arrivals:[...arrivals].sort((a,b) => a.index-b.index),failures,
        ...(failure === undefined ? {} : {failure}),pass,wallMs:Date.now()-began};
      writeFileSync(`${path}.next`, `${JSON.stringify(verdict,null,2)}\n`);
      renameSync(`${path}.next`,path);
      return verdict;
    };
    save();
    const batches = smokeBatches(pending);
    console.log(`J476 batches ${batches.map(batch => batch.length).join('/')}`);
    await Promise.all(batches.map(async (batch,lane) => {
      const context = contexts[lane];
      if (context === undefined) throw new Error('Missing phone smoke session');
      for (const index of batch) {
        const leg = route[index];
        if (leg === undefined) throw new Error('Missing seeded crossing');
        const pair = {index,from:leg.from.instance,to:leg.to.instance};
        /** @type {Page | undefined} */ let page;
        console.log(`START ${index+1}/${route.length} lane ${lane+1} ${pair.from} -> ${pair.to}`);
        try {
          page = await context.newPage();
          await bootSmokeSource(page,leg.from,build,`ZE ${began.toString(36).slice(-5)} ${String(index+1)}`);
          const {center,pitch} = await smokePose(page,leg);
          const ms = await crossZoneEntry(page,leg,center,pitch);
          arrivals.push({...pair,ms});
          failed.delete(index);
          console.log(`PASS ${index+1}/${route.length} ${pair.from} -> ${pair.to} (${ms} ms)`);
        } catch (error) {
          const detail = page === undefined ? '' : await Promise.race([crossingDetail(page),delay(2000,'')]);
          const reason = (error instanceof Error ? error.message : String(error)).split('\n')[0];
          const failure = {...pair,reason:`${reason}${detail ? ` (${detail})` : ''}`};
          failed.set(index,failure);
          console.log(`FAIL ${index+1}/${route.length} ${pair.from} -> ${pair.to}: ${failure.reason}`);
        } finally {
          await page?.close().catch(() => undefined);
          save();
        }
      }
    }));
    await requireStagingBuild(build);
    const verdict = save(true);
    console.log(`J476 ${verdict.pass ? 'PASS' : 'HOLD'} ${arrivals.length}/${route.length}, seed ${seed}, wall ${verdict.wallMs} ms`);
    return verdict.pass ? 0 : 1;
  } finally {
    await browser.close();
  }
}

/** Read either the raw smoke or the staging deploy verdict that contains it.
 * @param {unknown} value @returns {unknown} */
export function stagedTourProof(value) {
  const wrapped = /** @type {{deploy?:{zoneEntry?:unknown}} | null} */ (value);
  return wrapped?.deploy?.zoneEntry ?? value;
}

/** @param {string[]} argv */
async function main(argv) {
  /** @type {Map<string,string>} */ const options = new Map();
  for (let i=0;i<argv.length;i++) {
    const [name, ...inline] = (argv[i] ?? '').split('=');
    if (name === undefined || !['--expected-build','--out','--seed','--retry-failed','--zone-entry-resume','--full-route'].includes(name) ||
        options.has(name) || (name === '--full-route' && inline.length > 0)) throw new Error('Unknown or repeated zone-entry argument');
    const value = name === '--full-route' ? '' : inline.length > 0 ? inline.join('=') : argv[++i];
    if (value === undefined || (name !== '--full-route' && (value === '' || value.startsWith('--')))) throw new Error(`${name} needs a value`);
    options.set(name,value);
  }
  const build = options.get('--expected-build') ?? '', out = options.get('--out');
  if (!/^[a-f0-9]{40}$/u.test(build) || out === undefined) throw new Error('zone-entry-tour.mjs requires --expected-build and --out');
  const retry = options.get('--retry-failed'), resume = options.get('--zone-entry-resume'), input = retry ?? resume;
  if (retry !== undefined && resume !== undefined) throw new Error('Choose one zone-entry retry input');
  if (input !== undefined && resolve(input) === resolve(out,'zone-entry.json')) throw new Error('A zone-entry retry needs a fresh --out');
  const prior = input === undefined ? undefined : stagedTourProof(JSON.parse(readFileSync(input,'utf8')));
  const old = /** @type {Partial<SmokeReport> | null | undefined} */ (prior);
  const full = options.has('--full-route') || (resume !== undefined && old?.mode !== 'smoke');
  mkdirSync(out,{recursive:true});
  if (full) {
    if (retry !== undefined || options.has('--seed')) throw new Error('The full route uses --zone-entry-resume and has no seed');
    const legacy = join(out,'held-full-route.json');
    if (prior !== undefined) writeFileSync(legacy,JSON.stringify(prior));
    const child = spawnSync(process.execPath,[fileURLToPath(new URL('./zone-gate-proof.mjs',import.meta.url)),
      `--base=${STAGING}`,`--out=${out}`,'--engine=webkit','--target=far-reach','--deploy','--walk-all',`--expected-build=${build}`,
      ...(prior === undefined ? [] : [`--resume=${legacy}`])], {stdio:'inherit'});
    if (child.error !== undefined) throw child.error;
    return child.status ?? 1;
  }
  const seedArg = options.get('--seed');
  const seed = seedArg === undefined ? old?.seed ?? randomBytes(4).readUInt32LE(0) : /^\d+$/u.test(seedArg) ? Number(seedArg) : NaN;
  if (!validSeed(seed)) throw new Error('--seed must be an unsigned 32-bit integer');
  if (old !== undefined && (old?.mode !== 'smoke' || old.build !== build || old.engine !== 'webkit' || old.profile !== 'phone' ||
      old.pass !== false || old.seed !== seed)) throw new Error('Retry needs the saved seed and a held phone WebKit smoke for the same staging build');
  return runSmoke({build,out,seed,prior});
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(`HOLD zone-entry: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
