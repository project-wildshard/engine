import './format-hook.mjs';

const { CHUNK_HALF, ENTRY_ASPHALT } = await import('@wildshard/engine/core/config');
/** a home exit socket's centre from its cell centre (metres): the socket floor sits at the highway level */
const EXIT = CHUNK_HALF - ENTRY_ASPHALT / 2;

/** Browser-serialized reader: format 2 moves the original entryway rows into world/edge.
 * Verify that one declared section rather than treating its absent root field as a flat road. */
export async function readFloorGridEntryways(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Floor entry declaration unavailable');
  const index = await response.json();
  if (index.format === undefined) return index.entryways;
  if (index.format !== 'wildshard.shardfile' || index.formatVersion !== 2 || !Array.isArray(index.sections) || index.sections.length > 256)
    throw new Error('Unsupported floor entry descriptor');
  const matches = index.sections.filter(row => row.name === 'world/edge');
  if (matches.length === 0) return undefined;
  const [section] = matches;
  if (matches.length !== 1 || section.path !== 'sections/world/edge.json' || section.schema !== 'wildshard:world/edge@1'
    || !Number.isSafeInteger(section.bytes) || section.bytes <= 0 || section.bytes > 25_000_000 || !/^[a-f0-9]{64}$/u.test(section.hash))
    throw new Error('Invalid floor entry section');
  const source = await fetch(new URL(section.path, new URL(path, location.href)));
  if (!source.ok) throw new Error('Floor entry section unavailable');
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.length !== section.bytes) throw new Error('Floor entry section size mismatch');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== section.hash) throw new Error('Floor entry section hash mismatch');
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (payload.entryways !== undefined && !Array.isArray(payload.entryways)) throw new Error('Invalid floor entryways');
  return payload.entryways;
}

/** Follow the declared portal landing or socket-lift approach instead of guessing a flat entry waypoint. */
export function floorGridPortalPlan(plan, cell, entryways, pitch = 555) {
  if (!Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid grid floor pitch');
  const leaving = plan.from !== null && plan.to === null;
  if ((!leaving && (plan.from !== null || plan.start === undefined)) || !Array.isArray(entryways)) return plan;
  const origin = { x: cell.cell[0] * pitch, z: cell.cell[1] * pitch };
  const entry = leaving ? plan.waypoints[0] : plan.waypoints.at(-1) ?? plan.start;
  if (entry === undefined) throw new Error('Missing floor edge waypoint');
  const dx = entry.x - origin.x, dz = entry.z - origin.z;
  const edge = Math.abs(dz) >= Math.abs(dx) ? (dz >= 0 ? 'north' : 'south') : (dx >= 0 ? 'east' : 'west');
  const row = entryways.find(value => value?.edge === edge && (value.kind === 'portalLink' || value.kind === 'socketLift'));
  if (row === undefined) return plan;
  const prefix = plan.observePreparation === true ? plan.waypoints.slice(0, -1) : [];
  if (row.kind === 'socketLift') {
    if (leaving) return plan;
    const approach = row.lift?.approach?.route;
    if (!Array.isArray(approach) || approach.length < 2 || !approach.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) throw new Error('Invalid declared floor lift approach');
    return { ...plan, waypoints: [...prefix, ...approach.map(point => ({ x: origin.x + point[0], z: origin.z + point[2] }))], finishOnArrival: true };
  }
  const node = value => {
    if (typeof value?.id !== 'string' || value.id.length === 0 || !Array.isArray(value.at) || value.at.length !== 3
      || !value.at.every(Number.isFinite)) throw new Error('Invalid declared floor portal node');
    return { id: value.id, x: origin.x + value.at[0], y: value.at[1], z: origin.z + value.at[2] };
  };
  const road = node(row.portal?.road), destination = node(row.portal?.destination);
  if (leaving) {
    const exit = node(row.portal?.exit), route = row.portal?.route;
    if (!Array.isArray(row.portal?.links) || !row.portal.links.some(link => link.from === exit.id && link.to === road.id)) throw new Error('Missing declared floor portal exit link');
    if (!Array.isArray(route) || route.length < 2 || !route.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) throw new Error('Invalid declared floor portal exit route');
    return { ...plan, waypoints: [...route.map(point => ({ x: origin.x + point[0], z: origin.z + point[2] })), exit, road, ...plan.waypoints],
      portal: { road, destination: exit, reverse: true } };
  }
  if (!Array.isArray(row.portal?.links) || !row.portal.links.some(link => link.from === road.id && link.to === destination.id)) throw new Error('Missing declared floor portal link');
  return { ...plan, waypoints: [...prefix, road, destination], portal: { road, destination } };
}

/** Host side of floorGridPortalPlan: read the served cell's shardfile entryways in the page, so every road entry
 *  follows its declared portal or socket lift. A flat waypoint stops at Sky Reach's landing rail and on Nine Dragon's
 *  square after its portal, then times out (sp-o11: look48's two "timeouts" were this). */
export async function gridFloorDeclaredPlan(page, state, plan) {
  const leaving = plan.from !== null && plan.to === null;
  if (!leaving && (plan.from !== null || plan.start === undefined || plan.to === null)) return plan;
  const cell = state.cells.find(row => row.instance === (leaving ? plan.from : plan.to));
  if (!cell) throw new Error('Floor entry cell missing');
  const path = `/shardfiles/${encodeURIComponent(cell.slug)}/shard.json`;
  const entries = await page.evaluate(`(${readFloorGridEntryways.toString()})(${JSON.stringify(path)})`);
  return floorGridPortalPlan(plan, cell, entries, state.pitch === undefined ? 555 : state.pitch);
}

/** Preserve historical cameras when old pinned builds omit the lattice scalar. */
export function gridFloorPoses(pitch = 555) {
  if (!Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid grid floor pitch');
  const half = pitch / 2;
  return [{ name: 'grid-deck-east', x: half, y: 1.7, z: -40, yaw: 0, pitch: -0.08 },
    { name: 'grid-crossroads', x: half, y: 1.7, z: half, yaw: -Math.PI * 0.75, pitch: -0.12 },
    { name: 'grid-deck-north', x: 0, y: 3, z: 262 + (pitch - 555) / 2, yaw: Math.PI, pitch: -0.05 }];
}

/** Actual-frame floor routes; only the first home pose is seeded, every seam afterwards is driven by held input. */
export function gridFloorPlans(state, scenario, options = {}) {
  const pitch = state.pitch === undefined ? 555 : state.pitch, half = pitch / 2;
  if (!Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid grid floor pitch');
  const home = state.cells.find(cell => cell.instance === state.home);
  if (!home) throw new Error('Grid floor has no assembled home');
  const origin = cell => ({ x: cell.cell[0] * pitch, z: cell.cell[1] * pitch });
  const h = origin(home), plans = [];
  if (scenario === 'milestone') {
    // Each road entry is an independent approach after the continuous template out/back drive.
    // Seed its road, let the real source checkpoint/leave settle, then measure held input through the border.
    plans.push(...gridFloorPlans(state, 'template'));
    for (const slug of ['nine-dragon-stack', 'far-reach', 'nalati-grasslands', 'pine-hollow', 'sunscar-dunes', 'driftwood-isle']) {
      const target = state.cells.find(cell => cell.slug === slug);
      if (!target) throw new Error(`Milestone floor requires ${slug} (Nine requires --devserver)`);
      const t = origin(target), dx = Math.sign(h.x - t.x), dz = Math.sign(h.z - t.z);
      const vertical = dz !== 0 || dx === 0, direction = vertical ? (dz === 0 ? 1 : dz) : dx;
      const road = vertical ? { x: t.x, z: t.z + direction * half } : { x: t.x + direction * half, z: t.z };
      const entry = vertical ? { x: t.x, z: t.z + direction * 210 } : { x: t.x + direction * 210, z: t.z };
      plans.push({ name: `${slug}-road-entry`, from: null, to: target.instance, movement: 'road-hover', start: road,
        waypoints: [entry], requiredResidents: [target.instance], finishOnArrival: false });
    }
    return plans;
  }
  if (scenario === 'outer-road') {
    // SF88c (G526): a quarter lap of the 5 × 5's outer road round its south-east corner (2.8 km, inside the drive's
    // 160 s), the whole platform's far layer in view
    const e = 2.5 * pitch;
    // O11: the east road's inner lane past Nalati and Nine (ring 1, a cell column away): neither admits on the way
    const lane = e - 18;
    return [{ name: 'outer-road-corner', from: null, to: null, movement: 'road-hover', hoverMaxSpeed: 30, start: { x: 0, z: e },
      waypoints: [{ x: e, z: e }, { x: e, z: 0 }], requiredResidents: [], finishOnArrival: false },
    { name: 'outer-road-east', from: null, to: null, movement: 'road-hover', hoverMaxSpeed: 30, start: { x: lane, z: pitch },
      waypoints: [{ x: lane, z: -e + 30 }], requiredResidents: [], finishOnArrival: false }];
  }
  if (scenario === 'reentry') {
    // OT (2026-10-17): enter Pine, retire it by entering Signal Dunes, enter it again. A page-wide cache that kept a
    // resource the first resident freed fails only the second admission (Pine's posed atlas lost its GPU allocation).
    const milestone = gridFloorPlans(state, 'milestone');
    const road = slug => { const plan = milestone.find(row => row.name === `${slug}-road-entry`); if (!plan) throw new Error(`Re-entry floor requires ${slug}`); return plan; };
    const pine = road('pine-hollow');
    return [pine, road('sunscar-dunes'), { ...pine, name: 'pine-hollow-road-reentry' }];
  }
  if (scenario === 'nine-return') {
    // O12 (coordinator ruling 2026-10-21): the soak's Nine legs on the floor's own page: Nine entered cold from the road,
    // left by its portal, home again, twice (the soak froze 11-25 s on some Nine retire + home re-admission legs)
    const nine = state.cells.find(cell => cell.slug === 'nine-dragon-stack');
    if (!nine) throw new Error('Nine return requires the Developer Nine cell');
    const [entry] = gridFloorPlans(state, 'cell', { cell: nine.instance, roadApproach: true });
    if (!entry) throw new Error('Missing Nine road entry');
    const n = origin(nine), road = { x: n.x, z: n.z + half }, homeRoad = { x: h.x, z: road.z };
    const leave = { name: 'nine-leave', from: nine.instance, to: null, movement: 'road-hover', hoverMaxSpeed: 30, waypoints: [road], requiredResidents: [], finishOnArrival: false };
    const back = { name: 'home-return', from: null, to: home.instance, movement: 'road-hover', hoverMaxSpeed: 30,
      waypoints: [homeRoad, { x: h.x, z: h.z - 210 }], requiredResidents: [home.instance], finishOnArrival: false };
    return [entry, leave, back, { ...entry, name: 'nine-reentry', start: homeRoad }, { ...leave, name: 'nine-leave-2' }, { ...back, name: 'home-return-2' }];
  }
  if (scenario === 'sky-cycle') {
    // G782 / grid-crossing T2: the leak cycle. Sky Reach entered from the road, left to the road, home again, three times
    const sky = state.cells.find(cell => cell.slug === 'far-reach');
    if (!sky) throw new Error('Sky cycle requires the Sky Reach cell');
    const [entry] = gridFloorPlans(state, 'cell', { cell: sky.instance, roadApproach: true });
    if (!entry) throw new Error('Missing Sky Reach road entry');
    const s = origin(sky), road = { x: s.x, z: s.z + half }, homeRoad = { x: h.x, z: road.z };
    const leave = { name: 'sky-leave', from: sky.instance, to: null, movement: 'road-hover', hoverMaxSpeed: 30, waypoints: [road], requiredResidents: [], finishOnArrival: false };
    const back = { name: 'home-return', from: null, to: home.instance, movement: 'road-hover', hoverMaxSpeed: 30,
      waypoints: [homeRoad, { x: h.x, z: h.z - 210 }], requiredResidents: [home.instance], finishOnArrival: false };
    return [1, 2, 3].flatMap(round => [{ ...entry, name: `sky-entry-${round}`, ...(round === 1 ? {} : { start: homeRoad }) },
      { ...leave, name: `sky-leave-${round}` }, { ...back, name: `home-return-${round}` }]);
  }
  // O17: `cold` is the cell entry with no standing pose beside the cell first (frame-floor.mjs skips the deck poses)
  if (scenario === 'cell' || scenario === 'cold') {
    // op-frame22 (SF63 / G158): any assembled cell by its slug, entered from the road at the edge that faces home (a corner
    // cell from its home-side midpoint), one road seed, then held input into its interior
    const target = state.cells.find(cell => cell.instance === options.cell) ?? state.cells.find(cell => cell.slug === options.cell);
    if (!target) throw new Error(`Grid floor has no ${String(options.cell)} cell (a DEVSERVER-only cell needs --devserver)`);
    if (target.instance === home.instance) {
      if (options.roadApproach !== true) throw new Error('Grid floor home cell needs a cold road return');
      const [out, back] = gridFloorPlans(state, 'template');
      if (out === undefined || back === undefined) throw new Error('Grid floor home return requires a template');
      // Retire the owned home through actual travel before measuring its return. Reusing the boot
      // resident would hide preparation; this leg has no second pose seed or warm home allocation.
      return [{ ...out, movement: 'road-hover', hoverMaxSpeed: 30, retiredResidents: [home.instance] },
        { ...back, name: `${home.slug}-road-entry`, movement: 'road-hover', hoverMaxSpeed: 30, requiredResidents: [home.instance],
          observePreparation: true, finishOnArrival: false }];
    }
    const t = origin(target), dx = options.risingIslet === 'west' ? -1 : options.risingIslet === 'east' ? 1 : options.risingIslet ? 0 : Math.sign(h.x - t.x),
      dz = options.risingIslet === 'north' ? 1 : options.risingIslet === 'south' ? -1 : options.risingIslet ? 0 : Math.sign(h.z - t.z);
    const road = dz !== 0 ? { x: t.x, z: t.z + dz * half } : { x: t.x + dx * half, z: t.z };
    // A separately named socket measurement stays on the permanent platform deck,
    // before content-specific gates or lifts; the lift-ride probe is retired.
    const entryOffset = options.entrySocket === true || options.risingIslet ? CHUNK_HALF - ENTRY_ASPHALT / 2 : 210;
    const entry = dz !== 0 ? { x: t.x, z: t.z + dz * entryOffset } : { x: t.x + dx * entryOffset, z: t.z };
    // Drive into the geometric interior: a motor transfer outside the cell must not omit
    // the first visible regional frame from the measured drive.
    const approach = options.roadApproach === true;
    const start = approach ? (dz !== 0 ? { x: road.x + half, z: road.z } : { x: road.x, z: road.z + half }) : road;
    plans.push({ name: `${target.slug}-${options.entrySocket === true || options.risingIslet ? 'socket-entry' : 'road-entry'}`, from: null, to: target.instance, movement: 'road-hover', start,
      waypoints: approach ? [road, entry] : [entry], requiredResidents: [target.instance], finishOnArrival: false,
      ...(approach ? { observePreparation: true, hoverMaxSpeed: 30 } : {}) });

  }
  if (scenario === 'sun-entry') {
    const sun = state.cells.find(cell => cell.slug === 'sunscar-dunes');
    if (!sun) throw new Error('Developer grid floor requires Signal Dunes');
    const s = origin(sun), road = { x: s.x, z: s.z + half }, entry = { x: s.x, z: s.z + 210 };
    // Match the cold native ruler: seed the road once, then walk inside on the real terrain.
    plans.push({ name: 'sun-road-entry', from: null, to: sun.instance, movement: 'road-hover', start: road,
      waypoints: [entry], requiredResidents: [sun.instance] },
    { name: 'sun-authored-spawn', from: sun.instance, to: sun.instance, movement: 'road-hover',
      waypoints: [{ x: s.x, z: s.z + 70 }], requiredResidents: [sun.instance] },
    { name: 'sun-road-return', from: sun.instance, to: null, movement: 'road-hover',
      waypoints: [entry, road], requiredResidents: [] },
    { name: 'sun-reentry', from: null, to: sun.instance, movement: 'road-hover',
      waypoints: [entry], requiredResidents: [sun.instance] });
  }
  if (scenario === 'template' || scenario === 'all') {
    const peer = state.cells.filter(cell => cell.slug === '_template' && cell.instance !== home.instance)
      .sort((a, b) => a.instance.localeCompare(b.instance))[0];
    if (!peer) throw new Error('Grid floor has no template');
    const p = origin(peer), dx = Math.sign(p.x - h.x), dz = Math.sign(p.z - h.z);
    // leave from home's exit socket (its floor is the highway level): Driftwood's sea bed just inside its north socket lies
    // 0.8 m under the socket's edge, so a start at 230 m hovered into that ledge and the route timed out at waypoint 0
    const start = dz === 0 ? { x: h.x + dx * EXIT, z: h.z } : { x: h.x, z: h.z + dz * EXIT };
    const end = dx === 0 ? { x: p.x, z: p.z - dz * 230 } : { x: p.x - dx * 230, z: p.z };
    // Corners have no diagonal entrance: use the two midpoint turn-ins and their crossroads.
    const road = dx !== 0 && dz !== 0 ? [{ x: h.x, z: (h.z + p.z) / 2 },
      { x: (h.x + p.x) / 2, z: (h.z + p.z) / 2 }, { x: (h.x + p.x) / 2, z: p.z }] : [];
    plans.push({ name: 'template-interior', from: home.instance, to: peer.instance, start, waypoints: [...road, end], requiredResidents: [peer.instance] },
      { name: 'template-return', from: peer.instance, to: home.instance, waypoints: [...road].reverse().concat(start), requiredResidents: [] });
  }
  if (scenario === 'runtime-travel' || scenario === 'all') {
    const pine = state.cells.find(cell => cell.slug === 'pine-hollow'), nalati = state.cells.find(cell => cell.slug === 'nalati-grasslands');
    if (!pine || !nalati) throw new Error('Developer grid floor requires Pine and Nalati cells');
    const p = origin(pine), n = origin(nalati);
    if (p.x !== h.x || p.z <= h.z || n.z !== h.z || n.x <= h.x) throw new Error('Unexpected Developer travel layout');
    const road = { x: (h.x + n.x) / 2, z: (h.z + p.z) / 2 };
    plans.push({ name: 'pine-interior', from: home.instance, to: pine.instance, start: { x: h.x, z: h.z + EXIT },
      waypoints: [{ x: p.x, z: p.z - 230 }], requiredResidents: [pine.instance], retiredResidents: [home.instance] },
    { name: 'nalati-interior', from: pine.instance, to: nalati.instance,
      waypoints: [{ x: p.x, z: road.z }, road, { x: road.x, z: n.z }, { x: n.x - 230, z: n.z }],
      requiredResidents: [nalati.instance], retiredResidents: [pine.instance] });
  }
  return plans;
}

/** Capture a stable document identity; Safari time-origin drift is recorded, never mistaken for navigation. */
export function gridFloorDocumentIdentity() {
  window.__frameFloorGridDocumentToken ??= crypto.randomUUID();
  return { timeOrigin: performance.timeOrigin, token: window.__frameFloorGridDocumentToken };
}

/** Host adapter for ledger/smoke probes: seed only a declared first approach and fence every leg to one document. */
export async function runFloorGridRoute(page, plan, documentOrigin) {
  await page.evaluate(`(${stageFloorGrid.toString()})(${JSON.stringify(plan)},${JSON.stringify(documentOrigin)},(${driveFloorGrid.toString()}))`);
  return page.evaluate(`(${driveFloorGrid.toString()})(${JSON.stringify(plan)},${JSON.stringify(documentOrigin)})`);
}

/** Keep one diagnostic ledger in the browser and mirror it to the harness before a document/process can disappear. */
export function installFloorGridProgress() {
  let last = null, sampled = -Infinity;
  window.__frameFloorGridProgress = () => {
    const stop = window.__frameFloorGridStop;
    if (!stop) return null;
    if (performance.now() - sampled < 1000 && last?.stop.leg === stop.leg && last.stop.phase === stop.phase) return last;
    try {
      const grid = window.__wildshard?.shard?.grid;
      if (!grid) return last;
      if (window.__wildshard?.world?.game?.renderer.getContext().isContextLost()) return last;
      const state = grid.state(), residency = grid.residency(), live = state.live?.live;
      // The GL census is installed only in travel configurations, so its global can be absent here. The ledger reads its
      // totals only (op-hitch48): the full census lists and labels every resource, 14-17 ms on the Simulator once a second,
      // which drew a slow frame pair into every measured drive that the phone never pays. Reconciliation needs the full list.
      const totals = '__sc_gl_totals' in window, contexts = totals ? window.__sc_gl_totals() : '__sc_gl' in window ? window.__sc_gl() : null;
      last = { documentOrigin: performance.timeOrigin, sampledAt: Date.now(), seconds: performance.now() / 1000,
        stop: { ...stop }, current: live?.current, inside: state.inside, feet: live?.worldFeet, gameplayReady: live?.gameplayReady,
        admission: { residents: [...(live?.residents ?? [])], pending: [...(live?.pending ?? [])], issues: { ...live?.issues },
          crossing: state.live?.crossing === undefined ? null : { phase: state.live.crossing.phase, issue: state.live.crossing.issue },
          cellLoading: state.cellLoading ?? null },
        // the hook a stuck admission is waiting in (current), and the last completed ones
        runtimeTiming: state.live?.runtimeTiming ?? null,
        memory: { modelledMB: state.playingMB ?? null, accountedBytes: state.accountedBytes ?? null,
          ...(contexts ? { glMB: contexts.reduce((sum, row) => sum + row.totalBytes, 0) / 1e6, glReconciled: totals ? null : contexts.every(row => row.reconciled) }
            : { glMB: null, glReconciled: null }), claims: residency.claims, cost: residency.cost } };
      sampled = performance.now(); return last;
    } catch { return last; } // Diagnostic reads must not replace the original route/renderer failure.
  };
}

/** Select an explicit diagnostic cohort without changing any route or allowing a missing requested route. */
export function selectFloorGridPlans(plans, names = []) {
  if (names.length === 0) return plans;
  const requested = new Set(names);
  if (requested.size !== names.length) throw new Error('Duplicate requested grid route');
  for (const name of requested) if (!plans.some(plan => plan.name === name)) throw new Error(`Missing requested grid route: ${name}`);
  return plans.filter(plan => requested.has(plan.name));
}

/** A home-cell cold entry has an outward setup leg before its measured return. */
export function floorGridEntryRoute(plans, instance) {
  const index = plans.findIndex(plan => plan.to === instance);
  if (index === -1) throw new Error(`Missing grid entry for ${instance}`);
  return { setup: plans.slice(0, index), entry: plans[index] };
}

/** A lost travel document is a measured runtime failure, even when its earlier cadence rows passed. */
export function gridFloorRuntimeFailure(last, diagnostic) {
  if (!last || !diagnostic || diagnostic.documentOrigin === last.documentOrigin || !Number.isFinite(diagnostic.documentOrigin)) return null;
  const reason = diagnostic.lastEnd?.at >= last.documentOrigin ? diagnostic.lastEnd.reason
    : diagnostic.lastUnload?.t >= last.documentOrigin ? diagnostic.lastUnload.reason : 'Document navigated during grid travel; recovery reason unavailable';
  return { kind: /GPU|graphics recovery|canvas.*wiped/iu.test(reason) ? 'gpu-recovery' : 'navigation',
    stop: last.stop, lastSample: last, recoveryReason: reason, nextDocumentOrigin: diagnostic.documentOrigin };
}

/** Seed a cold source on solid road, then use the normal driver and admission; later legs never reseed. */
export async function stageFloorGrid(plan, documentOrigin, drive) {
  window.__frameFloorGridStop = { leg: plan.name, phase: 'source-admission', waypoint: null, target: plan.start ?? null };
  const deadline = performance.now() + 120000;
  const sameDocument = () => {
    if (typeof documentOrigin === 'number') return performance.timeOrigin === documentOrigin;
    const drift = performance.timeOrigin - documentOrigin.timeOrigin;
    window.__frameFloorGridOriginDrift = { deltaMs: drift, maximumAbsoluteMs: Math.max(Math.abs(drift), window.__frameFloorGridOriginDrift?.maximumAbsoluteMs ?? 0) };
    return window.__frameFloorGridDocumentToken === documentOrigin.token;
  };
  const readApi = () => {
    if (!sameDocument()) throw new Error('Grid floor document changed (navigation or graphics recovery)');
    return window.__wildshard;
  };
  let api = readApi();
  while (!api?.world?.game || !api.shard?.grid) {
    if (performance.now() >= deadline) throw new Error('Grid floor API did not become ready in its original document');
    await new Promise(resolve => { setTimeout(resolve, 100); }); api = readApi();
  }
  const world = api.world, player = world.player, input = world.game.app.input;
  const read = () => {
    if (readApi() !== api) throw new Error('Grid floor API was replaced during source admission');
    const state = api.shard.grid.state(); if (!state.live?.live) throw new Error('Grid live telemetry missing');
    const residency = api.shard.grid.residency();
    return { ...state, claims: residency.claims, entryPreparation: world.game.entryPreparation ?? null, ...(plan.borrowedHome === undefined ? {} : {
      borrowedHome: { instance: residency.home?.instance, bytes: residency.home?.bytes, level: world.game.level?.id } }) };
  };
  const borrowed = state => plan.borrowedHome === state.home && plan.from === state.home
    && state.borrowedHome?.instance === state.home && state.borrowedHome.level === state.cells.find(row => row.instance === state.home)?.slug
    && Number.isSafeInteger(state.borrowedHome.bytes) && state.borrowedHome.bytes > 0;
  const ready = (state, instance) => state.live.live.current === instance && state.inside === instance
    && state.live.live.gameplayReady && (instance === null || state.live.live.residents.includes(instance) === true || borrowed(state));
  const initial = read(), live = initial.live.live;
  const pitch = initial.pitch === undefined ? 555 : initial.pitch, half = pitch / 2;
  if (!Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid grid floor pitch');
  if (initial.live.crossing.phase === 'blocked' || initial.live.crossing.phase === 'save-failed') throw new Error(`Grid floor source blocked: ${initial.live.crossing.issue}`);
  const approach = plan.start && plan.from !== null && !ready(initial, plan.from);
  let seed = plan.start;
  if (approach) {
    if (typeof drive !== 'function') throw new Error('Grid floor cold source needs the real road driver');
    const cell = initial.cells.find(row => row.instance === plan.from);
    if (!cell) throw new Error('Grid floor source cell missing');
    const x = cell.cell[0] * pitch, z = cell.cell[1] * pitch;
    const dx = plan.start.x - x, dz = plan.start.z - z;
    seed = Math.abs(dz) >= Math.abs(dx) ? { x, z: z + (dz < 0 ? -half : half) }
      : { x: x + (dx < 0 ? -half : half), z };
  }
  // Standing probes can leave home entered. Only the first road seed may change that source;
  // its normal checkpoint / leave must still commit before the readiness loop below succeeds.
  if (live.current !== plan.from && !(plan.start && (live.current === null || plan.from === null))) throw new Error(`Grid floor starts in ${live.current}, expected ${plan.from}`);
  input.clear();
  if (seed) {
    const origin = { x: live.worldFeet.x - player.position.x, z: live.worldFeet.z - player.position.z };
    await api.pose({ x: seed.x - origin.x, y: 0.55, z: seed.z - origin.z, yaw: 0, pitch: -0.08 });
  }
  while (performance.now() < deadline) {
    const state = read();
    if (approach && ready(state, null)) {
      await drive({ name: `${plan.name}-source`, from: null, to: plan.from, movement: 'road-hover',
        waypoints: [plan.start], requiredResidents: [plan.from] }, documentOrigin);
      const entered = read();
      if (!ready(entered, plan.from)) throw new Error(`Grid floor source ${plan.from} is not an entered ready resident`);
      return entered;
    }
    if (!approach && ready(state, plan.from)) return state;
    if (!plan.start) throw new Error(`Grid floor source ${plan.from} is not an entered ready resident`);
    if (state.live.crossing.phase === 'blocked' || state.live.crossing.phase === 'save-failed') throw new Error(`Grid floor source blocked: ${state.live.crossing.issue}`);
    await new Promise(resolve => { setTimeout(resolve, 100); });
  }
  throw new Error(`Grid floor source ${plan.from} did not become an entered ready resident`);
}

/** This self-contained function is serialized into Chromium or Safari, without changing the game's fixed step. */
export async function driveFloorGrid(plan, documentOrigin) {
  window.__frameFloorGridStop = { leg: plan.name, phase: 'travel', waypoint: 0, target: plan.waypoints[0] ?? null };
  const api = window.__wildshard;
  const sameDocument = () => {
    if (typeof documentOrigin === 'number') return performance.timeOrigin === documentOrigin;
    const drift = performance.timeOrigin - documentOrigin.timeOrigin;
    window.__frameFloorGridOriginDrift = { deltaMs: drift, maximumAbsoluteMs: Math.max(Math.abs(drift), window.__frameFloorGridOriginDrift?.maximumAbsoluteMs ?? 0) };
    return window.__frameFloorGridDocumentToken === documentOrigin.token;
  };
  if (!sameDocument() || !api?.world?.game || !api.shard?.grid) throw new Error('Grid floor lost its ready document before travel (navigation or graphics recovery)');
  const world = api.world, player = world.player, input = world.game.app.input;
  // sp-o2 (O14): the per-frame observer reads the live state alone (`frame`): the residency table (every claim's frozen
  // row, the cost model) was ~2 ms a Simulator frame, max 24 ms, on Nine Dragon's road entry, which the phone never pays.
  const read = (frame = false) => {
    if (!sameDocument() || window.__wildshard !== api) throw new Error('Grid floor document or API changed during travel (navigation or graphics recovery)');
    const grid = api.shard.grid;
    const state = frame && typeof grid.travelState === 'function' ? grid.travelState() : grid.state();
    if (!state?.live?.live) throw new Error('Grid live telemetry missing');
    if (frame) return state;
    const residency = api.shard.grid.residency();
    return { ...state, claims: residency.claims, entryPreparation: world.game.entryPreparation ?? null, ...(plan.borrowedHome === undefined ? {} : {
      borrowedHome: { instance: residency.home?.instance, bytes: residency.home?.bytes, level: world.game.level?.id } }) };
  };
  const borrowed = state => plan.borrowedHome === state.home && plan.from === state.home
    && state.borrowedHome?.instance === state.home && state.borrowedHome.level === state.cells.find(row => row.instance === state.home)?.slug
    && Number.isSafeInteger(state.borrowedHome.bytes) && state.borrowedHome.bytes > 0;
  const source = read(), live = source.live.live, pitch = source.pitch === undefined ? 555 : source.pitch;
  if (!Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid grid floor pitch');
  if (live.current !== plan.from || source.inside !== plan.from || !live.gameplayReady || (plan.from !== null && !live.residents.includes(plan.from) && !borrowed(source))) throw new Error(`Grid floor source ${plan.from} is not an entered ready resident`);
  const waypoints = plan.waypoints;
  const portal = plan.portal === undefined ? null : { roadSeen: false, landed: false };
  const oldHover = player.hover, oldLimit = player.hoverSpeedLimit;
  const hoverMaxSpeed = plan.hoverMaxSpeed ?? 15;
  if (!Number.isFinite(hoverMaxSpeed) || hoverMaxSpeed <= 0 || hoverMaxSpeed > 30) throw new Error('Invalid grid harness hover speed');
  if (typeof oldLimit !== 'function') throw new Error('Grid hover-speed rule missing');
  input.clear();
  player.setHover(plan.movement !== 'road-hover' || live.current === null);
  let distance = 100;
  player.hoverSpeedLimit = () => Math.min(hoverMaxSpeed, oldLimit(), Math.max(3, distance * 1.5));
  const before = read(), trace = [], started = performance.now();
  const destination = before.cells.find(cell => cell.instance === plan.to);
  const arrival = plan.observePreparation !== true ? undefined : { blockedFrames: 0, blockedMs: 0, visibleBeforeReadyFrames: 0 };
  let previousFrameAt = started, exitSeen = false, worstFrameMs = 0;
  // The destination's region root, found once (a whole-scene name search each frame was ~0.8 s of a phone-4x Nine drive
  // charged to the frames it measures); found again only if it leaves the scene.
  let regionRoot = null;
  const region = () => {
    if (regionRoot === null || regionRoot.parent === null) regionRoot = world.game.rootScene.getObjectByName(`region:${plan.to}`) ?? null;
    return regionRoot;
  };
  try {
    await new Promise((resolve, reject) => {
      let stop = () => undefined, waypoint = 0, lastSample = -1;
      // Name where the drive stopped: a flat waypoint past a portal or a lift rail stalls at the landing (sp-o11)
      const where = () => { const at = trace.at(-1); return at === undefined ? 'no motion sample'
        : `waypoint ${waypoint}/${waypoints.length}, feet ${[at.x, at.y, at.z].map(v => Math.round(v * 10) / 10).join(', ')}, current ${String(at.current)}`; };
      const timer = setTimeout(() => { stop(); input.clear(); reject(new Error(`Grid floor route ${plan.name} timed out (${where()})`)); }, 150000);
      const finish = error => { stop(); clearTimeout(timer); input.clear(); if (error) reject(error instanceof Error ? error : new Error(String(error))); else resolve(undefined); };
      stop = world.game.watchFrames(() => {
        try {
          const state = read(true), active = state.live.live, feet = active.worldFeet, now = performance.now(), seconds = (now - started) / 1000;
          if (portal !== null) {
            const near = node => Math.hypot(feet.x - node.x, feet.z - node.z) < 1.5 && Math.abs(feet.y - node.y) < 0.5;
            if (plan.portal.reverse === true) {
              if (near(plan.portal.destination)) exitSeen = true;
              if (exitSeen && near(plan.portal.road) && player.onGround && active.current === plan.from && active.gameplayReady) {
                portal.roadSeen = true; portal.landed = true;
                // The real portal can transfer before the source-centre waypoint
                // is reached. Continue after its observed outgoing landing.
                const landing = waypoints.findIndex(point => point.x === plan.portal.road.x && point.z === plan.portal.road.z);
                if (landing === -1) throw new Error('Declared portal landing waypoint missing');
                waypoint = Math.max(waypoint, landing + 1);
              }
            } else {
              if (near(plan.portal.road)) portal.roadSeen = true;
              if (portal.roadSeen && near(plan.portal.destination) && player.onGround && active.current === plan.to && active.gameplayReady) portal.landed = true;
            }
          }
          if (arrival !== undefined && destination !== undefined) {
            const ready = active.residents.includes(plan.to) && !(active.pending ?? []).includes(plan.to);
            const edgeDistance = Math.hypot(Math.max(0, Math.abs(feet.x - destination.cell[0] * pitch) - 250),
              Math.max(0, Math.abs(feet.z - destination.cell[1] * pitch) - 250));
            if (!ready && active.current === null && edgeDistance <= 10 && distance > 1.5 && player.motor.result.horizontalFreedom < 0.1) {
              arrival.blockedFrames++; arrival.blockedMs += now - previousFrameAt;
            }
            if (!ready && region()?.visible === true) arrival.visibleBeforeReadyFrames++;
          }
          // O12: the longest frame interval of the leg (a soak's per-cell worst frame)
          worstFrameMs = Math.max(worstFrameMs, now - previousFrameAt); previousFrameAt = now;
          window.__frameFloorGridStop = { leg: plan.name, phase: 'travel', waypoint, target: waypoints[waypoint] ?? null };
          if (plan.movement === 'road-hover') player.setHover(active.current === null);
          if (seconds - lastSample >= 0.25) {
            const preparation = plan.observePreparation === true ? {
              pending: active.pending ?? [], resident: active.residents.includes(plan.to),
              visible: region()?.visible ?? null,
              hook: state.live.runtimeTiming?.current?.hook ?? null,
            } : undefined;
            trace.push({ seconds, ...feet, current: active.current, gameplayReady: active.gameplayReady, hover: player.hover,
              water: { mode: player.swimming ? 'swimming' : player.wading ? 'wading' : null,
                surface: player.waterSurface, eyeY: world.game.camera.position.y },
              ...(preparation === undefined ? {} : { preparation }) }); lastSample = seconds;
          }
          if (state.live.crossing.phase === 'blocked' || state.live.crossing.phase === 'save-failed') throw new Error(`Grid floor crossing blocked: ${state.live.crossing.issue}`);
          const target = waypoints[waypoint];
          if (plan.finishOnArrival === true && active.current === plan.to && state.inside === plan.to && active.gameplayReady) { finish(); return; }
          if (!target) {
            input.clear();
            if (active.current === plan.to && state.inside === plan.to && active.gameplayReady) {
              if (portal !== null && !portal.landed) return;
              finish();
            }
            return;
          }
          const dx = target.x - feet.x, dz = target.z - feet.z;
          distance = Math.hypot(dx, dz);
          const exitNode = plan.portal?.reverse === true && target.x === plan.portal.destination.x && target.z === plan.portal.destination.z;
          if (distance < (exitNode ? 0.25 : 1.5)) {
            waypoint++; input.clear(); return;
          }
          if (!active.gameplayReady) { input.clear(); return; }
          player.yaw = Math.atan2(-dx, -dz); input.setHeld('move.forward', true);
        } catch (error) { finish(error); }
      });
    });
    window.__frameFloorGridStop = { leg: plan.name, phase: 'destination-standing', waypoint: waypoints.length, target: null };
    return { plan, before, after: read(), trace, elapsedSeconds: (performance.now() - started) / 1000, worstFrameMs: Math.round(worstFrameMs),
      ...(arrival === undefined ? {} : { arrival }), ...(portal === null ? {} : { portal }) };
  } finally { input.clear(); player.hoverSpeedLimit = oldLimit; player.setHover(oldHover); }
}

/** A visible destination without real frame commits or complete runtime residency never counts as this scenario. */
export function gridFloorWitnessFailures(result) {
  const { plan, before, after } = result, previous = before.live.live, active = after.live.live, failures = [];
  const pitch = after.pitch === undefined ? 555 : after.pitch;
  if (!Number.isFinite(pitch) || pitch <= 500 || (before.pitch === undefined ? 555 : before.pitch) !== pitch) failures.push('Grid lattice changed during the route');
  const borrowed = state => plan.borrowedHome === state.home && plan.from === state.home
    && state.borrowedHome?.instance === state.home && state.borrowedHome.level === state.cells.find(row => row.instance === state.home)?.slug
    && Number.isSafeInteger(state.borrowedHome.bytes) && state.borrowedHome.bytes > 0;
  if (previous.current !== plan.from || before.inside !== plan.from || !previous.gameplayReady || (plan.from !== null && !previous.residents.includes(plan.from) && !borrowed(before))) failures.push('Source interior gameplay or runtime residency was not ready');
  const count = active.crossings - previous.crossings;
  const transitions = count === 0 ? [] : active.transitions.slice(-count);
  const expected = plan.from === plan.to ? [] : [
    ...(plan.from === null ? [] : [{ from: plan.from, to: null }]),
    ...(plan.to === null ? [] : [{ from: null, to: plan.to }]),
  ];
  if (count !== expected.length || JSON.stringify(transitions) !== JSON.stringify(expected)) failures.push('Expected source/road/destination frame commits');
  if (active.current !== plan.to || after.inside !== plan.to || !active.gameplayReady) failures.push('Destination interior gameplay is not ready');
  if (plan.requiredResidents.some(id => !active.residents.includes(id))) failures.push('Required runtime residents are missing');
  if (plan.portal !== undefined && (result.portal?.roadSeen !== true || result.portal.landed !== true)) failures.push('Declared portal road and landing were not traversed');
  if ((plan.retiredResidents ?? []).some(id => {
    if (active.residents.includes(id)) return true;
    if (after.claims === undefined) return true;
    return after.claims.some(claim => claim.owner === id && claim.category === 'sim');
  })) failures.push('Source runtime or its sim/basis claim was not retired');
  const cell = after.cells.find(row => row.instance === plan.to);
  if (plan.to !== null && (!cell || Math.abs(active.worldFeet.x - cell.cell[0] * pitch) >= 250 || Math.abs(active.worldFeet.z - cell.cell[1] * pitch) >= 250)) failures.push('Destination feet are outside its interior');
  if (plan.to === null && after.cells.some(row => Math.abs(active.worldFeet.x - row.cell[0] * pitch) < 250 && Math.abs(active.worldFeet.z - row.cell[1] * pitch) < 250)) failures.push('Road destination lies inside a shard');
  if (![active.worldFeet.x, active.worldFeet.y, active.worldFeet.z, result.elapsedSeconds].every(Number.isFinite)
    || result.elapsedSeconds <= 0 || result.trace.length === 0
    || result.trace.some((row, index) => {
      if (![row.seconds, row.x, row.y, row.z].every(Number.isFinite)) return true;
      if (row.y >= -0.25) return false;
      // Over-water sockets can put real wading/swimming feet below sea level.
      // Require actual water locomotion (or its adjacent same-surface entry
      // sample, before the motor lands) and an eye above the finite surface;
      // an underground fall or a submerged route still fails this witness.
      const water = row.water;
      const locomotion = candidate => candidate !== undefined && ['wading', 'swimming'].includes(candidate.mode);
      const adjacent = [result.trace[index - 1]?.water, result.trace[index + 1]?.water]
        .some(candidate => locomotion(candidate) && candidate.surface === water?.surface);
      return water === undefined || !(locomotion(water) || adjacent)
        || !Number.isFinite(water.surface) || !Number.isFinite(water.eyeY)
        || water.surface <= row.y || water.eyeY < water.surface;
    })) failures.push('Route has no valid above-ground or surface-water motion witness');
  return failures;
}
