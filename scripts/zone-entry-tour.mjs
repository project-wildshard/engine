// J476 smoke: real gates into the eight featured shards. J451's full route stays available by hand.
import { agentFetch as fetch } from './agent-requests.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { keepReleaseProof, openReleaseRun } from './release-run.mjs';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acceptPhoneMemoryWarning, deployFrameProblem, PHONE } from './journey-proof.mjs';
import { saveFixture } from './debug-settings.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';
import { TOUR_FEATURED as featured } from './zone-entry-featured.mjs';

/** @typedef {{instance:string, slug?:string, cell:readonly [number,number]}} Cell */
/** @typedef {{from:Cell, to:Cell}} Leg */
/** @typedef {{from:string,to:string}} Pair */
/** @typedef {{from:string,to:string,ms:number}} Arrival */
/** @typedef {Pair & {reason:string}} CrossingFailure */
/** @typedef {{expected:number, arrivals:Arrival[], failure?:CrossingFailure, retries?:CrossingFailure[], resumedFrom?:number, pass:boolean}} Tour */
/** @typedef {Arrival & {index:number, rejoinMs?:number, returnMs?:number}} SmokeArrival */
/** @typedef {CrossingFailure & {index:number}} SmokeFailure */
/** @typedef {{mode:'smoke', scope?:'loopback', batch?:number, build:string, engine:'webkit', profile:'phone', seed:number, cells: Cell[], expected:number,
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
  const ids = new Set(cells.map(cell => cell.instance)), spots = new Set(cells.map(cell => cell.cell.join(',')));
  if (ids.size !== cells.length || spots.size !== cells.length ||
      cells.some(cell => typeof cell.instance !== 'string' || cell.cell.length !== 2 ||
        cell.cell.some(at => !Number.isInteger(at) || Math.abs(at) > 3))) throw new Error('Invalid live smoke grid');
  if (featured.length !== 8 || new Set(featured).size !== 8) throw new Error('Zone Select must name eight featured shards');
  const edges = zoneEntryTour(cells);
  return shuffle(featured.flatMap(slug => {
    const matches = cells.filter(cell => (cell.slug ?? cell.instance) === slug), to = matches[0];
    if (to === undefined || matches.length !== 1) throw new Error(`Duplicate or missing featured shard in live grid: ${slug}`);
    // Keep the side order stable for verdicts written before the smoke shared the full route.
    const incoming = edges.filter(leg => leg.to === to);
    const choices = shuffle(SIDES.flatMap(([dx,dz]) => incoming.filter(({from}) =>
      from.cell[0] === to.cell[0]+dx && from.cell[1] === to.cell[1]+dz)));
    const first = choices[0];
    if (first === undefined) throw new Error(`No live gate into featured shard ${slug}`);
    return [first, choices[1] ?? first];
  }));
}

/** @template T @param {readonly T[]} pending @param {2|3} [walkers] @returns {T[][]} */
export function smokeBatches(pending, walkers = 3) {
  if (walkers === 3 && pending.length === 16) return [pending.slice(0,5), pending.slice(5,10), pending.slice(10)];
  return Array.from({length:walkers}, (_,lane) => pending.filter((_crossing,index) => index%walkers === lane));
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

/** @param {readonly Leg[]} route @param {unknown} report @param {string} build @param {number} seed @param {'loopback'} [scope] @param {number} [batch] */
export function retrySmokeEntries(route, report, build, seed, scope, batch) {
  const proof = /** @type {Partial<SmokeReport>|null} */ (report);
  if (proof?.mode !== 'smoke' || proof.scope !== scope || proof.build !== build || proof.engine !== 'webkit' || proof.profile !== 'phone' || proof.pass !== false)
    throw new Error('Retry needs a held phone WebKit smoke for the same staging build');
  if (proof.seed !== seed) throw new Error('Retry must use the saved seed');
  if (proof.batch !== batch) throw new Error('Retry must use the saved loopback batch');
  smokeEntries(route, proof);
  if (proof.failures === undefined || proof.failures.length === 0) throw new Error('The held verdict has no failed pairs to retry');
  return {arrivals:[...proof.arrivals ?? []], pending:proof.failures.map(row => row.index).sort((a,b) => a-b)};
}

/** @param {unknown} report */
export function smokeGap(report) {
  const proof = /** @type {SmokeReport} */ (report);
  try {
    const route = featuredZoneEntry(proof.cells, proof.seed);
    smokeEntries(route, proof);
    if (proof.scope === undefined && proof.pass && proof.failures.length === 0 && proof.arrivals.length === 16) {
      const rejoined = new Map(proof.arrivals.map(row => [row.index, row]));
      const missing = rejoinLegs(route).find(index => {
        const row = rejoined.get(index);
        return !(Number.isFinite(row?.rejoinMs) && Number.isFinite(row?.returnMs));
      });
      if (missing === undefined) return undefined;
      return `J451 zone-entry smoke has no menu-and-back for ${route[missing]?.to.instance ?? 'a zone'}`;
    }
  } catch { /* Only a complete, matching smoke qualifies a release. */ }
  return 'J476 zone-entry smoke did not pass all 16 seeded crossings';
}

/** QA 11-23-b row 20 (Jake, 2026-11-23: "Entity MMO is completely broken ... I was in the signal dunes loading screen and then it
 *  pops you out the main menu"): after the first seeded crossing into each zone but Driftwood, the guest leaves to the main menu,
 *  taps ENTER THE MMO, must be back in that zone through one loading screen (never by way of Driftwood), then crosses back.
 * @param {readonly Leg[]} route @returns {number[]} the route indexes that rejoin */
export function rejoinLegs(route) {
  const seen = new Set(), out = [];
  for (const [index, leg] of route.entries()) {
    if (leg.to.instance === DRIFTWOOD || seen.has(leg.to.instance)) continue;
    seen.add(leg.to.instance);
    out.push(index);
  }
  return out;
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
/** @typedef {(kind:'portal'|'road'|'walk', point:Point) => void} NoteWaypoint */
/** @typedef {readonly [number,number,number]} PortalPoint */
/** @typedef {{road:{at:PortalPoint},route:readonly PortalPoint[]}} PortalExit */
/** @typedef {import('playwright').Page} Page */
/** @param {Page} page */
const feet = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), st = w.__wildshard?.shard?.grid?.state?.();
  if (st === undefined || w.__wildshard?.world?.player === undefined) return null;
  return {x: Number(st.feet.x), z: Number(st.feet.z), home: String(st.home)};
});

/** @param {Page} page @param {Point} from @param {Point} toward @param {number} [turn] radians off facing `toward` */
const face = (page, from, toward, turn = 0) => page.evaluate(yaw => {
  /** @type {any} */ (window).__wildshard.world.player.yaw = yaw;
}, Math.atan2(from.x-toward.x, from.z-toward.z)+turn);

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
  const end = Date.now()+ms;
  await boundedUntil(() => end, run, message);
}

/** As `bounded`, to a deadline the run may push out once it knows its route.
 * @param {() => number} deadline @param {() => Promise<void>} run @param {string} message */
async function boundedUntil(deadline, run, message) {
  /** @type {ReturnType<typeof setInterval> | undefined} */ let timer;
  const time = new Promise((_resolve, reject) => { timer = setInterval(() => { if (Date.now() >= deadline()) reject(new Error(message)); }, 250); });
  try { await Promise.race([time, run()]); } finally { clearInterval(timer); }
}

/** The slowest the walker moves on an approach: a fresh guest swims Driftwood's harbour at about 2.6 m/s (opus-gate-p0's
 *  staging walk on 6bab8fcc took 168 s from the pier to the east approach), so a route's budget is its length at 2 m/s.
 * @param {Point} from @param {readonly Point[]} points @returns {number} the approach's milliseconds, never under APPROACH_MS */
export function approachBudget(from, points) {
  let length = 0, at = from;
  for (const point of points) { length += Math.hypot(point.x-at.x, point.z-at.z); at = point; }
  return Math.max(APPROACH_MS, Math.ceil(length/2)*1000);
}

/** The heading the arrival's walk proof tries next, as a turn from facing the zone's centre. A seat by a wall cannot walk at
 *  the centre: Nine Dragon's spawn deck stands against a wall on its centre side, and v0.1.81's menu-and-back seat at
 *  (0.9, 8.0) moved 0.07 to 0.11 m per 700 ms toward the centre on every try, but 2 to 3 m on the other headings
 *  (opus-fp21, staging 1e4f845e). The proof is that walk input moves the player, so it turns a quarter each try.
 * @param {number} attempt the tries so far @returns {number} radians added to the centre-facing yaw */
export function proofHeading(attempt) {
  return [0, Math.PI/2, -Math.PI/2, Math.PI][attempt%4] ?? 0;
}

/** The walker's way past a post or a pillar on its straight line (open-plot-2-0's centre pillar held it through two minutes
 *  of hops): a hop first, then side-steps that alternate and grow, so the walker clears either side of a wide obstacle.
 * @param {number} attempt the stalls since the walker last made headway @returns {{key:'Space'|'KeyD'|'KeyA', ms:number}} */
export function unstick(attempt) {
  if (attempt <= 0) return {key:'Space', ms:0};
  return {key: attempt%2 === 1 ? 'KeyD' : 'KeyA', ms: Math.min(4000, 800*attempt)};
}

/** Travel by input. Reading feet and setting the heading leaves the online seat under the server's control.
 * @param {Page} page @param {Point} target @param {number} end
 * @param {{sprint?:boolean, arriving?:string, within?:number, landed?:(here:Point)=>boolean}} [options] */
async function walk(page, target, end, {sprint = false, arriving, within = sprint ? 1.5 : 0.4, landed} = {}) {
  /** @type {Point | null} */ let last = null;
  let movedAt = Date.now(), stalls = 0, best = Number.POSITIVE_INFINITY;
  if (sprint) await page.keyboard.down('ShiftLeft');
  try {
    while (Date.now() < end) {
      const here = await feet(page).catch(() => null);
      if (here === null) { await delay(150); continue; }
      const distance = Math.hypot(here.x-target.x, here.z-target.z);
      if (here.home === arriving || distance <= within || landed?.(here) === true) return;
      // headway toward the target ends a run of stalls (a side-step's own motion does not)
      if (distance < best-3) { best = distance; stalls = 0; }
      await face(page, here, target);
      await page.keyboard.down('KeyW');
      if (last === null || Math.hypot(last.x-here.x, last.z-here.z) >= 0.5) {
        last = here;
        movedAt = Date.now();
      } else if (sprint && Date.now()-movedAt > 1200) {
        const step = unstick(stalls++);
        if (step.ms === 0) await page.keyboard.press(step.key);
        else {
          await page.keyboard.up('KeyW');
          await page.keyboard.down(step.key);
          try { await delay(step.ms); } finally { await page.keyboard.up(step.key); }
        }
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
 * @param {Page} page @param {string} slug @param {boolean} [missingIsEmpty] @returns {Promise<PortalExit[]>} */
async function portalExits(page, slug, missingIsEmpty = false) {
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
  const pageOrigin = new URL(page.url()).origin;
  const local = /^http:\/\/127\.0\.0\.1:\d+$/u.test(pageOrigin) && address.origin === pageOrigin;
  if (!local && !['https://packs.wildshard.io', STAGING].includes(address.origin)) throw new Error('Unexpected portal data origin');
  const response = await fetch(address, {signal: AbortSignal.timeout(10_000)});
  if (missingIsEmpty && response.status === 404) return [];
  if (!response.ok) throw new Error(`Could not read the portal rows (HTTP ${response.status})`);
  const edge = /** @type {{entryways?: {portal?:PortalExit}[]}} */ (await response.json());
  return (edge.entryways ?? []).flatMap(row => row.portal === undefined ? [] : [row.portal]);
}

/** Walk the shard's declared inland route to its portal, and identify the road deck it leads to.
 * @param {Page} page @param {Cell} from @param {NonNullable<ReturnType<typeof portalExitPlan>>} plan
 * @param {number} end @param {NoteWaypoint} noteWaypoint @returns {Promise<Cell>} */
async function walkPortalExit(page, from, plan, end, noteWaypoint) {
  /** @param {Point} point */
  const onDeck = point => plan.decks.some(deck => Math.hypot(point.x-deck.x, point.z-deck.z) < 5);
  for (const point of plan.walk) {
    noteWaypoint('portal', point);
    await walk(page, point, end, {landed: onDeck});
  }
  const landing = await page.waitForFunction(decks => {
    const st = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.();
    return st === undefined ? 0 : decks.findIndex(deck => Math.hypot(st.feet.x-deck.x, st.feet.z-deck.z) < 5) + 1;
  }, plan.decks, {timeout: Math.min(10_000, Math.max(1, end-Date.now())), polling: 150});
  // Keep the matching deck from the same frame. A new browser turn can sample the first movement off its edge.
  try {
    const deck = plan.decks[(await landing.jsonValue()) - 1];
    if (deck === undefined) throw new Error('The portal did not leave the walker on a declared deck');
    return {instance:from.instance, cell:[from.cell[0]+deck.dx, from.cell[1]+deck.dz]};
  } finally {
    await landing.dispose();
  }
}

/** A portal can carry the walker inside immediately after a gate. Walk the declared exit first.
 * @param {Page} page @param {Cell} from @param {Cell} last @param {Point} center @param {number} end
 * @param {NoteWaypoint} noteWaypoint @returns {Promise<Cell>} */
async function exitToRoad(page, from, last, center, end, noteWaypoint) {
  const at = await feet(page);
  if (at === null || Math.max(Math.abs(at.x-center.x), Math.abs(at.z-center.z)) >= HALF-30) return last;
  const plan = portalExitPlan(await portalExits(page, from.slug ?? from.instance), center,
    {x:last.cell[0]-from.cell[0], z:last.cell[1]-from.cell[1]});
  if (plan === null || plan.walk.length === 0) throw new Error('The gate seated the walker inland without a declared portal exit');
  return walkPortalExit(page, from, plan, end, noteWaypoint);
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

/** A fresh smoke guest starts at the shard's spawn. Use its actual portal route where one is declared.
 * @param {Page} page @param {Leg} leg @param {Point} center @param {number} pitch @param {number} end
 * @param {NoteWaypoint} noteWaypoint */
async function smokeApproach(page, leg, center, pitch, end, noteWaypoint) {
  const {from,to} = leg, dx = to.cell[0]-from.cell[0], dz = to.cell[1]-from.cell[1];
  const slug = from.slug ?? from.instance;
  const portals = await portalExits(page, slug, true);
  const plans = SIDES.map(([x,z]) => portalExitPlan(portals, center, {x,z})).filter(plan => plan !== null && plan.walk.length > 0);
  const at = await feet(page);
  if (at !== null) {
    const nearest = plans.flatMap(plan => plan.walk.slice(0,1).map(first => ({plan,distance:Math.hypot(first.x-at.x,first.z-at.z)})))
      .sort((a,b) => a.distance-b.distance)[0];
    if (nearest !== undefined) return roadApproach(await walkPortalExit(page,from,nearest.plan,end,noteWaypoint),leg,center,pitch);
  }
  return spawnApproach(slug, at ?? center, center, dx, dz);
}

/** A fresh guest's walk from its spawn to the gate approach, `dx`/`dz` the gate's side. Driftwood keeps the original gate
 *  proof's shore route round its harbour. Elsewhere the walker joins the gate's centre line on the gate's half of the cell
 *  and walks along it: the entryway's line is clear, a straight line from the spawn can climb onto a ledge and meet a wall
 *  (mirror-salt's west), and the cell's centre piece stands on the line (open-plot-4-2's).
 * @param {string} slug @param {Point} at @param {Point} center @param {number} dx @param {number} dz @returns {ApproachPoint[]} */
export function spawnApproach(slug, at, center, dx, dz) {
  /** @type {(readonly [number,number])[]} */
  let lead = [];
  if (slug === DRIFTWOOD) {
    if (dx !== 0) lead = [[dx*235,-194]];
    else if (dz > 0) lead = [[-235,-194],[-235,0],[-200,20],[-200,235]];
  } else if (slug === 'open-plot-fossil-badlands' && dz > 0) {
    // The spawn faces the centre block (x -31..31, z -30..34) with posts at its south corners: v0.1.60's smoke held at
    // (4.4, -29.1) on the north line. Back off south of the posts, take the clear x 62.5 column north, then join the line.
    lead = [[0,-60],[62.5,-60],[62.5,125],[0,125]];
  } else if (slug === 'mossgate' && dx < 0) {
    // The spawn stands on the west gate's line, 1.8 m off it, with a wall and a boulder 9 m west of it: v0.1.76's smokes held at
    // (553.3, 567.9) twice. Go 40 m north of the line first, west to the gate's half, then join the line.
    lead = [[0,40],[-125,40],[-125,0]];
  } else if (slug === 'brasscap-mesa' && dx > 0) {
    // From the depot, go south of the canyon wall before turning east onto the gate's line.
    lead = [[4,2.6],[4,45],[75,45],[125,0]];
  } else {
    // join the line on the gate's half, never nearer the centre than HALF/2: a cell's centre piece stands on its lines
    const along = dx !== 0 ? (at.x-center.x)*dx : (at.z-center.z)*dz, onto = dx*Math.max(along, HALF/2), ontoZ = dz*Math.max(along, HALF/2);
    if (dx !== 0 && Math.abs(at.z-center.z) > 3) lead = [[onto, 0]];
    else if (dz !== 0 && Math.abs(at.x-center.x) > 3) lead = [[0, ontoZ]];
  }
  return [...lead, /** @type {const} */ ([dx*(HALF-15),dz*(HALF-15)])]
    .map(([x,z]) => ({x:center.x+x,z:center.z+z,ride:false}));
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
  let tries = 0, best = 0;
  do {
    const before = await feet(page);
    if (before?.home === target) {
      await face(page, before, center, proofHeading(tries++));
      try { await page.keyboard.down('KeyW'); await delay(700); } finally { await page.keyboard.up('KeyW'); }
      const after = await feet(page);
      const moved = after?.home === target ? Math.hypot(after.x-before.x, after.z-before.z) : 0;
      if (moved >= 0.25) return;
      best = Math.max(best, moved);
    }
    await delay(250);
  } while (Date.now()+1500 < end);
  throw new Error(`Walk input did not move the player within the entry window (${tries} tries over ${Math.min(tries, 4)} headings, best ${best.toFixed(2)} m)`);
}

/** @param {Page} page */
const gridLayout = page => page.evaluate(() => {
    const st = /** @type {any} */ (window).__wildshard.shard.grid.state();
    return /** @type {{cells: Cell[],pitch:number}} */ (st);
});

/** @param {Page} page @param {Leg} leg @param {Point} center @param {number} pitch @param {Cell} [previous] @param {boolean} [fresh] */
async function crossZoneEntry(page, leg, center, pitch, previous, fresh = false) {
  const {from, to} = leg;
  const dx = to.cell[0]-from.cell[0], dz = to.cell[1]-from.cell[1];
  const gate = {x:center.x+dx*(pitch-HALF+2), z:center.z+dz*(pitch-HALF+2)};
  const targetCenter = {x:center.x+dx*pitch, z:center.z+dz*pitch};
  let approachEnd = Date.now()+APPROACH_MS;
  let approachDetail = 'before the first waypoint';
  /** @type {NoteWaypoint} */
  const noteWaypoint = (kind, point) => { approachDetail = `${kind} waypoint (${point.x.toFixed(1)}, ${point.z.toFixed(1)})`; };
  await boundedUntil(() => approachEnd, async () => {
    const approach = fresh ? await smokeApproach(page,leg,center,pitch,approachEnd,noteWaypoint)
      : previous === undefined ? [{x:center.x+dx*(HALF-15), z:center.z+dz*(HALF-15), ride:false}]
        : roadApproach(await exitToRoad(page, from, previous, center, approachEnd, noteWaypoint), leg, center, pitch);
    // the route is known now: its length sets the budget (a fresh guest's swim round Driftwood's harbour takes nearly 3 minutes)
    const at = await feet(page);
    if (at !== null) approachEnd = Math.max(approachEnd, Date.now()+approachBudget(at, approach));
    for (const point of approach) {
      noteWaypoint(point.ride ? 'road' : 'walk', point);
      await approachPoint(page, point, approachEnd);
    }
  }, 'The walker timed out on the gate approach').catch((/** @type {unknown} */ error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message.split('\n', 1)[0]} (${approachDetail})`, {cause:error});
  });
  const started = Date.now();
  await bounded(ENTRY_MS, async () => {
    await walk(page, gate, started+ENTRY_MS, {arriving: to.instance});
    await arrived(page, to.instance, targetCenter, started+ENTRY_MS);
  }, 'The next world did not reach drawn, interactive play within 90 seconds');
  return Date.now()-started;
}

/** One state read for the menu-and-back watch: the title's button, the loading card's zone, the grid's home.
 * @param {Page} page */
const rejoinState = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), st = w.__wildshard?.shard?.grid?.state?.();
  const mmo = document.querySelector('.ws-main-mmo'), load = document.querySelector('.ws-load:not(.hide)');
  const card = load !== null && getComputedStyle(load).display !== 'none' && load.getBoundingClientRect().height > 0;
  return {title: mmo !== null && mmo.getBoundingClientRect().height > 0, card,
    zone: card ? (load?.querySelector('[data-el="slug"]')?.textContent ?? '').trim().toLowerCase() : '',
    home: typeof st?.home === 'string' ? st.home : null};
}).catch(() => null);

/** QA 11-23-b row 20: pause, exit to the main menu, ENTER THE MMO, back in `zone` through one loading screen. Each throw names its
 *  step. @param {Page} page @param {Cell} zone @param {Point} center @returns {Promise<number>} ms from the tap to play */
async function rejoinFromMenu(page, zone, center) {
  /** @template T @param {string} name @param {() => Promise<T>} work @returns {Promise<T>} */
  const step = async (name, work) => {
    try { return await work(); } catch (error) {
      throw new Error(`menu and back, ${name}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, {cause:error});
    }
  };
  await step('pause', () => page.locator('.ws-touch-pause').tap({timeout:10_000}));
  await step('exit to the main menu', () => page.locator('.ws-gmenu.show .ws-gmenu-exit').tap({timeout:10_000}));
  await step('main menu', () => page.locator('.ws-main-mmo').waitFor({state:'visible', timeout:45_000}));
  const started = Date.now(), end = started+ENTRY_MS;
  // the card shows the zone's public name (Signal Dunes for sunscar-dunes): it must stay one name, and never Driftwood's
  const driftwood = DRIFTWOOD.replaceAll('-', ' ');
  /** @type {string | null} */ let named = null;
  let navigated = false;
  const nav = (/** @type {import('playwright').Frame} */ frame) => { if (frame === page.mainFrame()) navigated = true; };
  page.on('framenavigated', nav);
  try {
    await step('ENTER THE MMO', () => page.locator('.ws-main-mmo').tap({timeout:10_000}));
    let screens = 0, lastCard = 0, seenCard = false;
    for (;;) {
      if (Date.now() > end) throw new Error(`menu and back, ${zone.instance}: not in play within ${ENTRY_MS/1000} s of the tap`);
      const now = Date.now(), at = await rejoinState(page);
      if (at !== null) {
        if (at.card) {
          if (now-lastCard > 1500) screens++;
          lastCard = now; seenCard = true;
          if (at.zone !== '' && zone.instance !== DRIFTWOOD && at.zone === driftwood) throw new Error(`menu and back, ${zone.instance}: the loading screen names ${driftwood}`);
          if (at.zone !== '' && named !== null && at.zone !== named) throw new Error(`menu and back, loading screen: it named ${named}, then ${at.zone}`);
          if (at.zone !== '') named = at.zone;
        }
        if (at.home !== null && at.home !== zone.instance) throw new Error(`menu and back, ${zone.instance}: it went by way of ${at.home}`);
        if (at.title && navigated && seenCard && !at.card) throw new Error(`menu and back, ${zone.instance}: the loading screen dropped to the main menu`);
        if (at.home === zone.instance && !at.card) break;
      }
      await acceptPhoneMemoryWarning(page).catch(() => undefined);
      await delay(200);
    }
    if (screens !== 1) throw new Error(`menu and back, ${zone.instance}: ${screens} loading screens, not one`);
    await step(`play in ${zone.instance}`, () => arrived(page, zone.instance, center, end));
  } finally {
    page.off('framenavigated', nav);
  }
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
  const cross = (crossingPage, leg, previous) => {
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

/** @param {string} build @param {string} base */
async function requireSmokeBuild(build, base) {
  const response = await fetch(`${base}/version.json`, {cache:'no-store', signal:AbortSignal.timeout(15_000)});
  if (!response.ok || (await response.json()).build !== build) throw new Error('The page serves a different build from the zone-entry request');
}

/** Seat a normal guest at the source cell of an otherwise independent crossing.
 * @param {Page} page @param {Cell} source @param {string} build @param {string} name @param {string} base */
async function bootSmokeSource(page, source, build, name, base) {
  const url = new URL('/', base);
  url.search = new URLSearchParams({chunk:source.slug ?? source.instance, mute:'1', nolock:'1', skipintro:'1', fps:'60'}).toString();
  await page.goto(url.href, {waitUntil:'domcontentloaded', timeout:45_000});
  const nameBox = page.locator('#ws-name-box input');
  const nameSubmit = page.locator('#ws-name-box button[type=submit]');
  const stop = Date.now()+90_000;
  const nameActionTime = () => Math.max(1, Math.min(3000, stop-Date.now()));
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
      try {
        await nameBox.fill(name, {timeout:nameActionTime()});
        await nameSubmit.click({timeout:nameActionTime()});
      } catch (error) {
        // A slow or replaced form gets another poll inside the source boot deadline.
        if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
      }
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

/** @param {{build:string, out:string, seed:number, prior?:unknown, loopback?:{base:string,socket:string,batch?:number}}} options */
async function runSmoke({build, out, seed, prior, loopback}) {
  const began = Date.now(), path = join(out, 'zone-entry.json');
  const base = loopback?.base ?? STAGING;
  const scope = loopback === undefined ? undefined : 'loopback';
  const {webkit} = await import('./browser-playwright.mjs');
  await requireSmokeBuild(build, base);
  console.log(`J476 zone-entry seed ${seed}; exact build ${build}`);
  // Independent guest sessions share one admitted headless WebKit owner.
  const browser = await webkit.launch({headless:true});
  try {
    const newContext = async () => {
      const context = await browser.newContext({...PHONE,isMobile:true});
      await context.addInitScript(guardStagingSockets, loopback?.socket ?? 'wss://rooms-staging.wildshard.io');
      await saveFixture(context, {scope:'device',key:'firstPlayDone',data:true});
      await saveFixture(context, {scope:'device',key:'devMode',data:true});
      await saveFixture(context, {scope:'global',key:'settings',merge:true,data:{volume:0}});
      return context;
    };
    /** @type {Cell[]} */ let cells;
    if (prior === undefined) {
      const context = await newContext(), discovery = await context.newPage();
      try {
        await bootSmokeSource(discovery, {instance:DRIFTWOOD,cell:[0,0]}, build, `ZE ${began.toString(36).slice(-5)} G`, base);
        ({cells} = await gridLayout(discovery));
      } catch (error) {
        const detail = await Promise.race([crossingDetail(discovery),delay(2000,'')]);
        throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? ` (${detail})` : ''}`, {cause:error});
      } finally {
        await context.close();
      }
    } else {
      // New placement overlays can arrive between attempts. Keep the saved
      // draw and let each retried pair verify its live source and destination.
      cells = /** @type {SmokeReport} */ (prior).cells;
    }
    cells = cells.map(({instance,slug,cell}) => ({instance,...(slug === undefined ? {} : {slug}),cell}));
    const draw = featuredZoneEntry(cells,seed), batchId = loopback?.batch;
    const route = batchId === undefined ? draw : smokeBatches(draw)[batchId];
    if (route === undefined) throw new Error('Unknown loopback batch');
    const fullRoute = zoneEntryTour(cells);
    // QA 11-23-b row 20: the staging smoke's menu-and-back legs (a loopback batch is a slice of the route and has no title world)
    const rejoins = new Set(scope === undefined ? rejoinLegs(route) : []);
    const {arrivals,pending} = prior === undefined
      ? {arrivals:[],pending:route.map((_,index) => index)}
      : retrySmokeEntries(route,prior,build,seed,scope,batchId);
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
        ...(scope === undefined ? {} : {scope}), ...(batchId === undefined ? {} : {batch:batchId}),
        ...(failure === undefined ? {} : {failure}),pass,wallMs:Date.now()-began};
      writeFileSync(`${path}.next`, `${JSON.stringify(verdict,null,2)}\n`);
      renameSync(`${path}.next`,path);
      return verdict;
    };
    save();
    // Each hosted batch gives its WebKit guest a runner. Staging keeps three walkers.
    const walkers = scope === 'loopback' && process.env.GITHUB_ACTIONS === 'true' ? 2 : 3;
    const batches = batchId === undefined ? smokeBatches(pending, walkers) : [pending];
    console.log(`J476 batches ${batches.map(batch => batch.length).join('/')}`);
    await Promise.all(batches.map(async (batch,lane) => {
      for (const index of batch) {
        const leg = route[index];
        if (leg === undefined) throw new Error('Missing seeded crossing');
        const pair = {index,from:leg.from.instance,to:leg.to.instance};
        /** @type {Page | undefined} */ let page;
        /** @type {import('playwright').BrowserContext | undefined} */ let context;
        console.log(`START ${index+1}/${route.length} lane ${lane+1} ${pair.from} -> ${pair.to}`);
        try {
          // A new guest context prevents a failed source boot or its service
          // worker from leaking into the next pair assigned to this worker.
          context = await newContext();
          page = await context.newPage();
          // The full walk leaves Far Reach or Nalati from a road deck. Enter
          // from Driftwood first to start at the same reachable approach.
          const roadStart = leg.from.instance === SKY || leg.from.instance === 'nalati-grasslands';
          const stagingLeg = roadStart ? fullRoute.find(edge => edge.from.instance === DRIFTWOOD && edge.to === leg.from) : undefined;
          await bootSmokeSource(page,stagingLeg?.from ?? leg.from,build,`ZE ${began.toString(36).slice(-5)} ${String(index+1)}`,base);
          if (stagingLeg !== undefined) {
            const start = await smokePose(page,stagingLeg);
            await crossZoneEntry(page,stagingLeg,start.center,start.pitch,undefined,true);
          }
          const {center,pitch} = await smokePose(page,leg);
          const ms = await crossZoneEntry(page,leg,center,pitch,stagingLeg?.from,stagingLeg === undefined);
          if (!rejoins.has(index)) arrivals.push({...pair,ms});
          else {
            const back = {from:leg.to,to:leg.from};
            const rejoinMs = await rejoinFromMenu(page,leg.to,(await smokePose(page,back)).center);
            console.log(`REJOIN ${index+1}/${route.length} ${pair.to} from the main menu (${rejoinMs} ms)`);
            const home = await smokePose(page,back);
            // the room's kept place is by the gate; a guest it seats inland walks out as a fresh one does
            const at = await feet(page), inland = at !== null && Math.max(Math.abs(at.x-home.center.x),Math.abs(at.z-home.center.z)) < HALF-30;
            const returnMs = await crossZoneEntry(page,back,home.center,home.pitch,inland ? undefined : leg.from,inland).catch((/** @type {unknown} */ error) => {
              throw new Error(`return crossing ${pair.to} -> ${pair.from}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, {cause:error});
            });
            arrivals.push({...pair,ms,rejoinMs,returnMs});
          }
          failed.delete(index);
          console.log(`PASS ${index+1}/${route.length} ${pair.from} -> ${pair.to} (${ms} ms)`);
        } catch (error) {
          const detail = page === undefined ? '' : await Promise.race([crossingDetail(page),delay(2000,'')]);
          const reason = (error instanceof Error ? error.message : String(error)).split('\n')[0];
          const failure = {...pair,reason:`${reason}${detail ? ` (${detail})` : ''}`};
          failed.set(index,failure);
          console.log(`FAIL ${index+1}/${route.length} ${pair.from} -> ${pair.to}: ${failure.reason}`);
        } finally {
          await context?.close().catch(() => undefined);
          save();
        }
      }
    }));
    await requireSmokeBuild(build, base);
    const verdict = save(true);
    console.log(`J476 ${verdict.pass ? 'PASS' : 'HOLD'} ${arrivals.length}/${route.length}, seed ${seed}, wall ${verdict.wallMs} ms`);
    return verdict.pass ? 0 : 1;
  } finally {
    await browser.close();
  }
}

/** FS29 exercises the same walker on the exact signed local rig. Its verdict cannot qualify a staging deploy.
 * @param {{build:string, out:string, seed:number, prior?:unknown, base:string, socket:string, batch?:number}} options */
export function runLoopbackSmoke({base, socket, batch, ...options}) {
  const page = new URL(base), rooms = new URL(socket);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || page.origin !== base ||
      !/^ws:\/\/127\.0\.0\.1:\d+$/u.test(socket) || rooms.origin !== socket ||
      !/^[a-f0-9]{40}$/u.test(options.build) || !validSeed(options.seed)) {
    throw new Error('The loopback tour needs an exact build, seed and local page and rooms origins');
  }
  mkdirSync(options.out, {recursive:true});
  if (batch !== undefined && ![0,1,2].includes(batch)) throw new Error('Use loopback batch 0, 1 or 2');
  return runSmoke({...options, loopback:{base,socket,...(batch === undefined ? {} : {batch})}});
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
  const build = options.get('--expected-build') ?? '', proof = options.get('--out');
  if (!/^[a-f0-9]{40}$/u.test(build) || proof === undefined) throw new Error('zone-entry-tour.mjs requires --expected-build and --out');
  const retry = options.get('--retry-failed'), resume = options.get('--zone-entry-resume'), input = retry ?? resume;
  if (retry !== undefined && resume !== undefined) throw new Error('Choose one zone-entry retry input');
  if (input !== undefined && resolve(input) === resolve(proof,'zone-entry.json')) throw new Error('A zone-entry retry needs a fresh --out');
  const prior = input === undefined ? undefined : stagedTourProof(JSON.parse(readFileSync(input,'utf8')));
  const old = /** @type {Partial<SmokeReport> | null | undefined} */ (prior);
  const full = options.has('--full-route') || (resume !== undefined && old?.mode !== 'smoke');
  const scratch = openReleaseRun(process.cwd(), 'zone');
  const out = scratch.work;
  try {
    if (full) {
      if (retry !== undefined || options.has('--seed')) throw new Error('The full route uses --zone-entry-resume and has no seed');
      const legacy = join(out,'held-full-route.json');
      if (prior !== undefined) writeFileSync(legacy,JSON.stringify(prior));
      const child = spawnSync(process.execPath,[join(import.meta.dirname,'zone-gate-proof.mjs'),
        `--base=${STAGING}`,`--out=${out}`,'--engine=webkit','--target=far-reach','--deploy','--walk-all',`--expected-build=${build}`,
        ...(prior === undefined ? [] : [`--resume=${legacy}`])], {stdio:'inherit'});
      if (child.error !== undefined) throw child.error;
      return child.status ?? 1;
    }
    const seedArg = options.get('--seed');
    const seed = seedArg === undefined ? old?.seed ?? randomBytes(4).readUInt32LE(0) : /^\d+$/u.test(seedArg) ? Number(seedArg) : Number.NaN;
    if (!validSeed(seed)) throw new Error('--seed must be an unsigned 32-bit integer');
    if (old !== undefined && (old?.mode !== 'smoke' || old.build !== build || old.engine !== 'webkit' || old.profile !== 'phone' ||
        old.pass !== false || old.seed !== seed)) throw new Error('Retry needs the saved seed and a held phone WebKit smoke for the same staging build');
    return await runSmoke({build,out,seed,prior});
  } finally {
    try { keepReleaseProof(out, proof, ['zone-entry.json']); }
    finally { scratch.close(); }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(`HOLD zone-entry: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
