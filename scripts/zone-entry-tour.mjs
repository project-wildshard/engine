// J451: walk the live grid using the gate proof's existing guest page.
import { setTimeout as delay } from 'node:timers/promises';
import { deployFrameProblem } from './journey-proof.mjs';

/** @typedef {{instance:string, slug?:string, cell:readonly [number,number]}} Cell */
/** @typedef {{from:Cell, to:Cell}} Leg */
/** @typedef {{from:string,to:string}} Pair */
/** @typedef {{from:string,to:string,ms:number}} Arrival */
/** @typedef {{expected:number, arrivals:Arrival[], failure?:Pair & {reason:string}, pass:boolean}} Tour */
const SIDES = /** @type {const} */ ([[1, 0], [0, 1], [-1, 0], [0, -1]]);
const DRIFTWOOD = 'driftwood-isle', SKY = 'far-reach', HALF = 250, ENTRY_MS = 90_000, APPROACH_MS = 120_000;
export const FIRST_ZONE_PAIR = Object.freeze({from: DRIFTWOOD, to: SKY});

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

/** @typedef {{x:number,z:number}} Point */
/** @typedef {Point & {ride:boolean}} ApproachPoint */
/** @typedef {readonly [number,number,number]} PortalPoint */
/** @typedef {{road:{at:PortalPoint},route:readonly PortalPoint[]}} PortalExit */
/** @typedef {Point & {dx:number,dz:number}} RoadDeck */
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

/** @param {Page} page */
function loadingDetail(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.ws-load [data-el="foot"]'));
    const visible = rows.find(row => row.getClientRects().length > 0);
    const st = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.();
    return String(visible?.textContent?.trim() ?? st?.cellStep?.step ?? '').replaceAll(/\s+/gu, ' ').slice(0, 150);
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
    const base = new URL(baked ? home.base : bank.contentBase || document.baseURI);
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

/** @param {Page} page @param {Point} origin @param {Tour} result @param {() => void} save */
export async function walkZoneEntryTour(page, origin, result, save) {
  const {cells, pitch} = await page.evaluate(() => {
    const st = /** @type {any} */ (window).__wildshard.shard.grid.state();
    return /** @type {{cells: Cell[],pitch:number}} */ (st);
  });
  const route = zoneEntryTour(cells);
  result.expected = route.length;
  const start = route[0]?.from.cell;
  if (start === undefined) throw new Error('The live grid contains no gate crossings');
  /** @type {Cell | undefined} */ let previous;
  for (const leg of route) {
    const {from, to} = leg, pair = {from: from.instance, to: to.instance};
    const center = {x: origin.x+(from.cell[0]-start[0])*pitch, z: origin.z+(from.cell[1]-start[1])*pitch};
    const dx = to.cell[0]-from.cell[0], dz = to.cell[1]-from.cell[1];
    const gate = {x: center.x+dx*(pitch-HALF+2), z: center.z+dz*(pitch-HALF+2)};
    const targetCenter = {x:center.x+dx*pitch,z:center.z+dz*pitch};
    const arrivedFrom = previous;
    result.failure = {...pair, reason: 'The runner stopped during this crossing'};
    save();
    try {
      const approachEnd = Date.now()+APPROACH_MS;
      await bounded(APPROACH_MS, async () => {
        const approach = arrivedFrom === undefined
          ? [{x: center.x+dx*(HALF-15), z: center.z+dz*(HALF-15), ride: false}]
          : roadApproach(await exitToRoad(page, from, arrivedFrom, center, approachEnd), leg, center, pitch);
        for (const point of approach) await approachPoint(page, point, approachEnd);
      }, 'The walker timed out on the gate approach');
      const started = Date.now();
      await bounded(ENTRY_MS, async () => {
        await walk(page, gate, started+ENTRY_MS, {arriving: to.instance});
        await arrived(page, to.instance, targetCenter, started+ENTRY_MS);
      }, 'The next world did not reach drawn, interactive play within 90 seconds');
      result.arrivals.push({...pair, ms: Date.now()-started});
      previous = from;
      console.log(`PASS ${pair.from} -> ${pair.to}`);
    } catch (error) {
      const loading = await Promise.race([loadingDetail(page), delay(2000, '')]);
      const reason = error instanceof Error ? error.message : String(error);
      result.failure = {...pair, reason: `${reason.split('\n')[0]}${loading ? ` (loading ${loading})` : ''}`};
      return;
    }
  }
  delete result.failure;
  result.pass = true;
}
