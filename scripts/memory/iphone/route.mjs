// meta IPHONE13-DRIFTWOOD DW1 (mini-driftwood13, 2026-11-19): a zone's route bench. After control the player plays a fixed
// route of segments on foot (no teleport: staging has no harness, and a player walks), and each segment keeps its own
// frames: fps, frame p50/p95/max, frames over 33 and 50 ms, update and render ms, gpu~, the worker clock's delay and
// jitter, triangles, draws and programs. The page's frame cap is held at 30 or 60 for the whole route, so one route reads
// both the Low Power (30) and the phone-Low (60) frame on any build.
//
// Kinds: `stand` (still, the view turning `turn` rad/s), `walk` (through `points` once; `sprint` holds sprint), `fight`
// (walk to the nearest live creature of `prey` near `points[0]`, then face it and swing for `seconds`).
// Driftwood's waypoints follow its sand paths (shard-driftwood src/data/layout.json PATHS) from the pier to the boar
// field: out to the altar and back on the west path (sprinting back), then the centre, the wreck and the boars.

/** @typedef {{ name: string, kind: 'stand'|'walk'|'fight', seconds: number, points?: [number, number][], sprint?: boolean,
 *   turn?: number, prey?: string, reach?: number, grid?: boolean, fixed?: boolean,
 *   dwell?: { point: number, seconds: number, face?: [number, number], road?: boolean }, face?: [number, number] }} RouteLeg */

/** @type {Readonly<Record<string, readonly RouteLeg[]>>} */
export const ROUTES = Object.freeze({
  'driftwood-isle': Object.freeze([
    { name: 'dock spawn', kind: 'stand', seconds: 30 },
    { name: 'pier to beach', kind: 'walk', seconds: 40, points: [[0, -186], [-6, -172], [-18, -150], [-30, -142]] },
    { name: 'plateau climb', kind: 'walk', seconds: 40, points: [[-30, -120], [-30, -104], [-24, -80], [-20, -68]] },
    { name: 'castaway camp (NPC)', kind: 'stand', seconds: 20, turn: 0.4 },
    { name: 'west path', kind: 'walk', seconds: 60, points: [[-36, -50], [-52, -30], [-64, -4], [-72, 20], [-82, 50], [-88, 70], [-94, 88], [-97, 102]] },
    { name: 'altar arena', kind: 'stand', seconds: 20, turn: 0.4 },
    { name: 'west path back', kind: 'walk', seconds: 60, points: [[-94, 88], [-88, 70], [-82, 50], [-72, 20], [-61, -9], [-55, -21], [-50, -33], [-42, -43], [-34, -53], [-24, -60]] },
    { name: 'central path', kind: 'walk', seconds: 40, points: [[-8, -50], [4, -36], [14, -24], [17, 8]] },
    { name: 'wreck beach', kind: 'walk', seconds: 50, points: [[30, 6], [45, 3], [60, 0], [100, -2], [130, 2], [140, 4]] },
    { name: 'boar field', kind: 'walk', seconds: 50, points: [[118, -34], [100, -80], [86, -118], [76, -132]] },
    { name: 'boar fight', kind: 'fight', seconds: 20, prey: 'boar', points: [[74, -140]] },
  ]),
  // DF2. Coordinates are local to Driftwood, even when the grid seats it away from the origin.
  'driftwood-fps': Object.freeze([
    { name: 'dock spawn', kind: 'stand', seconds: 30, turn: 0.4, grid: true, fixed: true },
    { name: 'beach', kind: 'walk', seconds: 40, points: [[0, -186], [-6, -172], [-18, -150], [-30, -142], [-30, -124]], grid: true, fixed: true },
    { name: 'village', kind: 'walk', seconds: 60, points: [[-30, -120], [-30, -104], [-24, -80], [-20, -68]],
      dwell: { point: 3, seconds: 20 }, turn: 0.4, grid: true, fixed: true },
    // questSteps has no completion steps. The camp's lit fire is at hut + (0.7, -9.8) in questPageComposition.
    { name: 'quest fire', kind: 'walk', seconds: 30, points: [[-21, -70], [-24, -80], [-30, -104], [-30, -120]],
      dwell: { point: 0, seconds: 20, face: [-21.3, -73.8] }, sprint: true, reach: 1.5, grid: true, fixed: true },
    // DF5: the phone reaches re-entry at ~35 s, then rebuilds and warms the retired home (~6.6 s).
    // Keep one fixed minute on every host, including all admission frames and the unchanged road dwell.
    { name: 'road crossing', kind: 'walk', seconds: 60, sprint: true, reach: 2, grid: true, fixed: true,
      points: [[-30, -142], [0, -152], [0, -205], [0, -263], [0, -248]],
      dwell: { point: 3, seconds: 10, face: [0, -194], road: true } },
  ]),
});

/** The start of a leg's error when the player died mid-leg (`routeLegOnPage`); table.mjs restarts the world on it. */
export const ROUTE_DIED = 'the player died during the route';

/** The route for a zone, or a refusal naming the zones that have one. @param {string} slug */
export function routeFor(slug) {
  const route = ROUTES[slug];
  if (route === undefined) throw new Error(`No route for ${slug}; routes: ${Object.keys(ROUTES).join(', ')}`);
  return route;
}

/** In the page: play one leg and keep its frames per second. Must not close over anything outside itself.
 * @param {RouteLeg & { cap: 0 | 30 | 60 | null, approach?: boolean }} leg */
export function routeLegOnPage(leg) {
  const api = /** @type {any} */ (window).__wildshard, w = api?.world;
  if (!w || !w.hud.entered || w.hud.paused || !w.game.frameGate()) return Promise.resolve({ error: 'cannot run a route leg before control' });
  const game = w.game, input = game.app.input, p = w.player, renderer = game.renderer;
  const grid = api?.shard?.grid, state = leg.grid ? grid?.state?.() : undefined;
  const cell = state?.cells.find((/** @type {{slug:string,instance:string}} */ row) => row.slug === 'driftwood-isle' && row.instance === state.home);
  if (leg.grid && (!cell || !Number.isFinite(state.pitch) || game.level.id !== 'platform.grid')) return Promise.resolve({ error: 'Driftwood grid home required' });
  const [originX, originZ] = cell ? [cell.cell[0] * state.pitch - (state.feet.x - p.position.x),
    cell.cell[1] * state.pitch - (state.feet.z - p.position.z)] : [0, 0];
  if (leg.grid && leg.kind === 'stand' && Math.hypot(p.position.x - originX, p.position.z - originZ + 194) > 8)
    return Promise.resolve({ error: 'the route starts at the Driftwood dock' });
  const travel = () => typeof grid.travelState === 'function' ? grid.travelState() : grid.state();
  // the cap: Game re-reads qualityCap every 2 s from the preset and Low Power; held here for the whole leg
  if (leg.cap !== null) {
    try { Object.defineProperty(game, 'qualityCap', { get: () => leg.cap, set: () => { /* held */ }, configurable: true }); } catch { /* read-only */ }
  }
  /** @type {import('../../../src/client/engine/net/client').NetClient | undefined} */
  const client = p.link?.client;
  const clock = client?.clock ?? null;
  // GPU traffic per second (DW1, for opus-fps: does the Memory saver purge and re-upload?): texture uploads, buffer uploads
  // and buffer read-backs (a released array read again, memorySaver.ts restore), counted on the context's prototype once
  const counts = leg.fixed ? null : (/** @type {any} */ (window).__wsRouteGl ??= (() => {
    const tally = { tex: 0, buf: 0, read: 0, audioStarts: 0, audioEnds: 0, busyMs: 0 };
    const proto = /** @type {any} */ (globalThis).WebGL2RenderingContext?.prototype;
    const wrap = (/** @type {string} */ name, /** @type {'tex'|'buf'|'read'} */ key) => {
      const original = proto?.[name];
      if (typeof original !== 'function') return;
      proto[name] = function counted(/** @type {unknown[]} */ ...args) { tally[key]++; return original.apply(this, args); };
    };
    for (const name of ['texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'compressedTexSubImage2D', 'texImage3D', 'texSubImage3D']) wrap(name, 'tex');
    for (const name of ['bufferData', 'bufferSubData']) wrap(name, 'buf');
    wrap('getBufferSubData', 'read');
    // live Web Audio sources (opus-fps, Jake's 17 Pro video: 4 -> 42 in 12 s on the dock), as perfHud's own counter: a start
    // adds one, its 'ended' takes it off; installed at the first leg, so sources started before then are not in it
    const audioProtos = [globalThis.AudioScheduledSourceNode?.prototype, globalThis.AudioBufferSourceNode?.prototype];
    for (const audioProto of audioProtos) {
      if (audioProto === undefined || !Object.hasOwn(audioProto, 'start')) continue;
      const original = audioProto.start;
      audioProto.start = function start(/** @type {unknown[]} */ ...args) {
        tally.audioStarts++;
        this.addEventListener('ended', () => { tally.audioEnds++; }, { once: true });
        original.apply(this, args);
      };
    }
    // main-thread busy: a MessageChannel ping loop runs between tasks, so its longest gap is the longest task. A long frame
    // with short gaps waited on the GPU; with a long gap the main thread was busy (DW2)
    // DF18 (mini-dw3): the ping loop allocates a message event per task, garbage that outlives the young generation on
    // its own (Chromium: ~4 MB/s promoted over DW1's route); `busy: false` leaves it out (busyMs then reads 0)
    if (leg.busy !== false) {
      const channel = new MessageChannel();
      let lastPing = performance.now();
      channel.port1.onmessage = () => {
        const now = performance.now();
        tally.busyMs = Math.max(tally.busyMs, now - lastPing);
        lastPing = now;
        setTimeout(() => { channel.port2.postMessage(0); }, 0);
      };
      channel.port2.postMessage(0);
    }
    return tally;
  })());
  // the Memory saver installs its own bufferData on the context (memorySaver.ts), bound before this wrap: count that one too
  const gl = counts === null ? null : renderer.getContext?.();
  if (gl && Object.hasOwn(gl, 'bufferData') && !gl.__wsRouteCounted) {
    const own = gl.bufferData;
    gl.bufferData = function bufferData(/** @type {unknown[]} */ ...args) { counts.buf++; return own.apply(this, args); };
    gl.__wsRouteCounted = true;
  }
  let seenGl = { ...counts };
  const memChip = () => {
    for (const el of document.querySelectorAll('.ws-perf-dock *')) {
      const text = el.textContent?.trim() ?? '';
      if (/^mem\s+[\d.]+/iu.test(text) && text.length < 16) return text;
    }
    return null;
  };
  const t0 = performance.now(), frames0 = game.frameCount;
  /** @type {number[]} */
  const receiptSpacingErrorsMs = [];
  const stopSpacing = leg.approach ? undefined : client?.onFrame((_frame, ms) => {
    // Older builds call the listener with only the decoded frame.
    if (typeof ms === 'number' && Number.isFinite(ms)) receiptSpacingErrorsMs.push(ms);
  });
  let seen = game.frameCount, previous = t0, last = t0, at = 0, metres = 0, prevX = p.position.x, prevZ = p.position.z;
  let detours = 0, detourUntil = 0, detourYaw = 0, pressedLock = 0, checkX = prevX, checkZ = prevZ, still = 0, swings = 0, target = /** @type {any} */ (null), engaged = false;
  /** @type {any[]} */ const samples = [];
  const nav = { reached: 0, stuck: /** @type {number[][]} */ ([]), skipped: 0, metres: 0, path: /** @type {number[][]} */ ([]),
    expected: leg.points?.length ?? 0, road: false, returned: false, dwellMs: 0, admissionMs: 0, lostFrames: 0,
    target: /** @type {unknown} */ (null), engagedAt: /** @type {number|null} */ (null) };
  const points = leg.points ?? [], reach = leg.reach ?? 3;
  let dwellStart = 0, dwelled = false, navAt = t0;
  // the game's own lock-on finds the prey (AimTargets lockOn: the candidate in view, then the locked target), as a player does
  const preyNear = () => {
    const lock = w.lockState;
    const pick = lock?.target ?? lock?.candidate ?? null;
    if (pick === null || pick.alive === false || (leg.prey !== undefined && pick.kind !== undefined && pick.kind !== leg.prey)) return null;
    if (lock.state !== 'locked' && performance.now() - pressedLock > 500) { pressedLock = performance.now(); input.press('lock'); }
    return pick;
  };
  const steer = (/** @type {number} */ dx, /** @type {number} */ dz, /** @type {number} */ dt) => {
    const want = Math.atan2(-dx, -dz), turn = ((want - p.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    // Approaches are unmeasured: align before walking through a reversal.
    // Measured legs retain the player-like turn rate and every navigation check.
    p.yaw = leg.approach ? want : p.yaw + Math.max(-4 * dt, Math.min(4 * dt, turn));
    return Math.abs(turn);
  };
  /** @type {(value: unknown) => void} */ let finish = () => undefined;
  const done = new Promise((resolve) => { finish = resolve; });
  let ended = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timeout;
  const sample = (/** @type {number} */ now) => {
    const frames = game.frameCount - seen, ring = game.frameMs.length;
    nav.lostFrames += Math.max(0, frames - ring);
    const frameMs = [], updateMs = [], renderMs = [], gpuApproxMs = [];
    seen = game.frameCount;
    for (let k = Math.min(frames, ring); k >= 1; k--) {
      const i = (game.frameI - k + ring) % ring;
      frameMs.push(game.frameMs[i]); updateMs.push(game.updateMs[i]); renderMs.push(game.renderMs[i]);
      gpuApproxMs.push(Math.max(0, game.frameMs[i] - Math.max(game.updateMs[i] + game.renderMs[i], 1000 / 30)));
    }
    samples.push({ tMs: now - t0, seconds: (now - previous) / 1000, frames, frameMs, updateMs, renderMs, gpuApproxMs,
      draws: game.lastFrame.calls, triangles: game.lastFrame.triangles, programs: renderer.info?.programs?.length ?? null,
      delayMs: clock?.delayMs ?? null, jitterMs: clock?.jitterMs ?? null, receiptSpacingErrorsMs: receiptSpacingErrorsMs.splice(0),
      ...(counts === null ? {} : {
        texUploads: counts.tex - seenGl.tex, bufUploads: counts.buf - seenGl.buf, readBacks: counts.read - seenGl.read,
        audioStarts: counts.audioStarts - seenGl.audioStarts, audioLive: counts.audioStarts - counts.audioEnds, busyMs: Math.round(counts.busyMs),
        textures: renderer.info?.memory?.textures ?? null, geometries: renderer.info?.memory?.geometries ?? null, mem: memChip(),
      }),
      at: [Math.round((p.position.x - originX) * 10) / 10, Math.round((p.position.z - originZ) * 10) / 10] });
    previous = now; seenGl = { ...counts }; if (counts !== null) counts.busyMs = 0;
  };
  const end = (/** @type {string|null} */ error) => {
    if (ended) return;
    ended = true;
    stopSpacing?.();
    clearTimeout(timeout);
    timeout = undefined;
    input.setHeld('move.forward', false); input.setHeld('sprint', false); input.setHeld('attack', false);
    if (leg.fixed && !leg.approach && performance.now() > previous) sample(performance.now());
    nav.metres = Math.round(metres);
    finish({ error, samples, nav, frames: game.frameCount - frames0, ms: performance.now() - t0, cap: leg.cap,
      programs: renderer.info?.programs?.length ?? null });
  };
  const step = () => {
    if (ended) return;
    const now = performance.now(), elapsed = now - last, dt = Math.min(0.1, elapsed / 1000), s = (now - t0) / 1000;
    last = now;
    if (w !== /** @type {any} */ (window).__wildshard?.world || document.visibilityState !== 'visible') { end('the page lost the controlled world during the leg'); return; }
    // DF15 (mini-df15, 2026-11-23): a creature can kill the bench player (a night's dev world runs for hours, and Driftwood's
    // black bear came to stand at the quest fire): name the death, so the table restarts the world instead of grading a respawn
    if (document.documentElement?.dataset.wsState === 'dead') {
      const cause = document.querySelector('.ws-combat-death-cause')?.textContent?.trim() ?? '';
      end(`the player died during the route: ${cause === '' ? 'cause not shown' : cause}`); return;
    }
    const x = p.position.x - originX, z = p.position.z - originZ;
    const movedSinceFrame = Math.hypot(p.position.x - prevX, p.position.z - prevZ);
    if (leg.fixed && movedSinceFrame > 18) { end('position jumped during the route'); return; }
    metres += movedSinceFrame; prevX = p.position.x; prevZ = p.position.z;
    // Uncapped native runs can fill the 120-frame ring in less than 150 ms.
    const ringFilling = leg.fixed && game.frameCount - seen >= game.frameMs.length / 2;
    if (!leg.approach && (ringFilling || now - previous >= (leg.fixed ? 150 : 1000))) sample(now);
    const returning = leg.dwell?.road === true && nav.road && !nav.returned;
    const road = returning ? travel() : undefined, crossing = road?.live?.crossing;
    const held = crossing?.current === null && crossing.target === state.home &&
      (crossing.phase === 'preparing' || crossing.phase === 'ready');
    if (held) nav.admissionMs += elapsed;
    const returnedNow = returning && road?.inside === state.home;
    if (returnedNow) nav.returned = true;
    if (now - navAt >= 1000) {
      navAt = now;
      nav.path.push([Math.round(s), Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
      const moved = Math.hypot(p.position.x - checkX, p.position.z - checkZ);
      checkX = p.position.x; checkZ = p.position.z;
      if (leg.kind !== 'stand' && !engaged && at < points.length && moved < 1 && (dwellStart === 0 || dwelled) &&
        !held && !returnedNow) {
        still++;
        nav.stuck.push([Math.round(s), Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
        input.setHeld('jump', true); setTimeout(() => { input.setHeld('jump', false); }, 150);
        // a player blocked steps aside and tries again: left, then right, then wider; the waypoint is skipped after five
        if (still >= 2) { detours++; detourUntil = now + 1200; detourYaw = p.yaw + (detours % 2 === 1 ? 1 : -1) * Math.PI * (detours > 2 ? 0.75 : 0.5); }
        if (detours >= 5) { at++; nav.skipped++; detours = 0; still = 0; }
      } else still = 0;
    }
    const over = s >= leg.seconds;
    if (leg.fixed && leg.kind === 'walk') {
      const point = points[at];
      const dwelling = leg.dwell !== undefined && at === leg.dwell.point + 1 && !dwelled;
      if (dwelling) {
        if (dwellStart === 0) dwellStart = now;
        nav.dwellMs = now - dwellStart;
        const look = leg.dwell?.face ?? leg.face;
        if (look !== undefined) steer(look[0] - x, look[1] - z, dt);
        else if (leg.turn !== undefined) p.yaw += leg.turn * dt;
        if (leg.dwell?.road && !nav.road && z < -250 && travel().inside === null) nav.road = true;
        if (nav.dwellMs >= (leg.dwell?.seconds ?? 0) * 1000) {
          dwelled = true;
          navAt = now;
          checkX = p.position.x; checkZ = p.position.z;
        }
      }
      const waitingForReentry = leg.dwell?.road === true && at === points.length - 1 && !nav.returned;
      if (!dwelling && !waitingForReentry && point !== undefined && Math.hypot(point[0] - x, point[1] - z) < reach) { at++; nav.reached++; detours = 0; }
      const next = !dwelling && (leg.dwell === undefined || at !== leg.dwell.point + 1 || dwelled) ? points[at] : undefined;
      input.setHeld('move.forward', next !== undefined); input.setHeld('sprint', next !== undefined && leg.sprint === true);
      if (next !== undefined) {
        const [nextX, nextZ] = next;
        if (now < detourUntil) p.yaw = detourYaw;
        else steer(nextX - x, nextZ - z, dt);
      } else if (!dwelling && leg.face !== undefined) steer(leg.face[0] - x, leg.face[1] - z, dt);
      const arrived = leg.approach === true && at === points.length && (leg.dwell === undefined || dwelled);
      if (over || arrived) {
        end(nav.reached !== points.length || nav.stuck.length > 0 || (leg.dwell !== undefined && !dwelled)
          || (leg.dwell?.road && !(nav.road && nav.returned)) ? 'incomplete waypoint, dwell or road return' : null);
        return;
      }
      requestAnimationFrame(step);
      return;
    }
    if (leg.kind === 'stand') {
      if (leg.turn !== undefined) p.yaw += leg.turn * dt;
      if (over) { end(null); return; }
    } else if (leg.kind === 'walk' || (leg.kind === 'fight' && !engaged)) {
      const point = points[at];
      if (leg.kind === 'fight' && (point === undefined || Math.hypot(point[0] - x, point[1] - z) < 14)) {
        target = preyNear();
        if (target === null) { p.yaw += 0.8 * dt; input.setHeld('move.forward', false); }
        else {
          engaged = true; nav.engagedAt = Math.round(s * 10) / 10; nav.target = target.kind ?? target.species ?? 'creature';
          input.setHeld('move.forward', false); input.setHeld('sprint', false);
        }
      }
      if (!engaged) {
        if (point === undefined) { if (leg.kind === 'walk' || over) { end(null); return; } }
        else if (Math.hypot(point[0] - x, point[1] - z) < reach) { at++; nav.reached++; detours = 0; }
        else if (now < detourUntil) { p.yaw = detourYaw; input.setHeld('move.forward', true); }
        else { steer(point[0] - x, point[1] - z, dt); input.setHeld('move.forward', true); input.setHeld('sprint', leg.sprint === true); }
        if (over) { end(null); return; }
      }
    }
    if (leg.kind === 'fight' && engaged) {
      const position = target?.position;
      if (over) { nav.reached = swings; end(null); return; }
      if (position) {
        const dx = position.x - x, dz = position.z - z, d = Math.hypot(dx, dz);
        steer(dx, dz, dt);
        input.setHeld('move.forward', d > 2.2);
        const swing = d < 3.5 && Math.floor(s * 2) % 2 === 0;
        if (swing && !input.held('attack')) swings++;
        input.setHeld('attack', swing);
        if (target.alive === false) { const next = preyNear(); if (next !== null) target = next; }
      }
    }
    requestAnimationFrame(step);
  };
  timeout = setTimeout(() => { end('leg overran its time'); }, (leg.seconds + 30) * 1000);
  requestAnimationFrame(step);
  return done;
}

/** @param {number[]} values @param {number} q */
const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)] ?? null;
};
/** @param {(number|null)[]} values */
const finite = (values) => /** @type {number[]} */ (values.filter((value) => typeof value === 'number' && Number.isFinite(value)));

/** One leg's numbers from its per-second samples. Pure.
 * @param {{seconds:number, frames:number, frameMs:number[], updateMs:number[], renderMs:number[], gpuApproxMs:number[],
 *   draws:number, triangles:number, programs:number|null, delayMs:number|null, jitterMs:number|null, receiptSpacingErrorsMs?:number[]}[]} samples */
export function legSummary(samples) {
  const seconds = samples.reduce((sum, row) => sum + row.seconds, 0);
  const frames = samples.flatMap((row) => row.frameMs);
  const spacingErrors = samples.flatMap((row) => row.receiptSpacingErrorsMs ?? []);
  const over = (/** @type {number} */ ms) => frames.filter((value) => value > ms).length;
  const round = (/** @type {number|null} */ value, digits = 1) => value === null ? null : Number(value.toFixed(digits));
  return {
    seconds: round(seconds), fps: round(seconds > 0 ? samples.reduce((sum, row) => sum + row.frames, 0) / seconds : null),
    p50Ms: round(percentile(frames, 0.5)), p95Ms: round(percentile(frames, 0.95)), maxMs: round(frames.length > 0 ? Math.max(...frames) : null),
    over33: over(1000 / 30 + 0.7), over50: over(50), over50Per30s: round(seconds > 0 ? over(50) * 30 / seconds : null),
    updateP50Ms: round(percentile(samples.flatMap((row) => row.updateMs), 0.5)), updateP95Ms: round(percentile(samples.flatMap((row) => row.updateMs), 0.95)),
    renderP50Ms: round(percentile(samples.flatMap((row) => row.renderMs), 0.5)), renderP95Ms: round(percentile(samples.flatMap((row) => row.renderMs), 0.95)),
    gpuApproxP95Ms: round(percentile(samples.flatMap((row) => row.gpuApproxMs), 0.95)),
    delayMs: round(percentile(finite(samples.map((row) => row.delayMs)), 0.5), 0), delayMaxMs: round(Math.max(0, ...finite(samples.map((row) => row.delayMs))), 0),
    jitterMs: round(percentile(finite(samples.map((row) => row.jitterMs)), 0.5)), jitterMaxMs: round(Math.max(0, ...finite(samples.map((row) => row.jitterMs)))),
    receiptSpacingP95Ms: round(percentile(spacingErrors, 0.95)),
    receiptSpacingMaxMs: round(spacingErrors.length > 0 ? Math.max(...spacingErrors) : null),
    trianglesP95: percentile(samples.map((row) => row.triangles), 0.95), drawsP95: percentile(samples.map((row) => row.draws), 0.95),
    programsMax: Math.max(0, ...finite(samples.map((row) => row.programs))),
    texUploads: samples.reduce((sum, row) => sum + (row.texUploads ?? 0), 0), bufUploads: samples.reduce((sum, row) => sum + (row.bufUploads ?? 0), 0),
    readBacks: samples.reduce((sum, row) => sum + (row.readBacks ?? 0), 0),
    texturesMin: Math.min(...finite(samples.map((row) => row.textures ?? null))), texturesMax: Math.max(0, ...finite(samples.map((row) => row.textures ?? null))),
    mem: samples.findLast((row) => typeof row.mem === 'string')?.mem ?? null,
    audioLiveMax: Math.max(0, ...finite(samples.map((row) => row.audioLive ?? null))), audioLiveEnd: samples.at(-1)?.audioLive ?? null,
    audioStartsPerS: round(seconds > 0 ? samples.reduce((sum, row) => sum + (row.audioStarts ?? 0), 0) / seconds : null),
  };
}

/** Ask for a Screen Wake Lock (a backup to Auto-Lock Never: a gap between runs can't sleep the phone) and say what the
 * browser answered: 'granted', 'unsupported' or the refusal. The lock lasts while the page stays visible. */
export const holdWake = `
  const done = arguments[arguments.length - 1];
  if (!('wakeLock' in navigator)) { done('unsupported'); return; }
  const answer = (pending) => pending.then((lock) => { window.__wsRouteWake = lock; return lock.released ? 'released' : 'granted'; },
    (error) => 'refused: ' + String(error?.name ?? error) + ' ' + String(error?.message ?? ''));
  // a gesture call (the inspector's emulateUserGesture) leaves its request here; without one, ask now
  answer(window.__wsRouteWakeAsk ?? navigator.wakeLock.request('screen')).then(done);
`;

/** QA 27 (the coordinator, 2026-11-19): with no finger on the glass the page's AudioContext stays suspended, so every source
 * it starts looks live for good. Run as a gesture (the inspector's emulateUserGesture), a touchend on the body reaches
 * audio/unlock.ts's window capture listeners, which resume the context as a real first tap does; no game control reads it. */
export const unlockAudio = `(() => { let event; try { event = new TouchEvent('touchend', { bubbles: true, cancelable: true }); } catch { event = new Event('touchend', { bubbles: true, cancelable: true }); }
  document.body.dispatchEvent(event); return 'touchend'; })()`;

/** The expression a driver's gesture() runs first, so the request has transient activation. */
export const askWake = "(window.__wsRouteWakeAsk = navigator.wakeLock?.request('screen'), true)";

/** Wait (at most 15 s) for the grid reveal to end; answer its timings (null: no reveal on this page). */
const revealEnd = `
  const done = arguments[arguments.length - 1];
  const t0 = performance.now();
  const wait = () => {
    const reveal = window.__wsReveal ?? null;
    if (reveal === null && performance.now() - t0 > 1000) { done(null); return; }
    if (reveal !== null && (reveal.endedMs !== null || performance.now() - t0 > 15000)) {
      done({ ...reveal, waitedMs: Math.round(performance.now() - t0) }); return;
    }
    setTimeout(wait, 100);
  };
  wait();
`;

/** Open the Developer frame panel and press REC 30 S (WebDriver-style async body). */
const recStart = `
  const done = arguments[arguments.length - 1];
  const up = (el) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
  const root = document.querySelector('.ws-perf');
  if (!root) { done('no frame panel (Developer off?)'); return; }
  if (!root.querySelector('.ws-perf-panel.open')) up(root);
  const t0 = performance.now();
  const press = () => { const button = document.querySelector('.ws-perf-rec'); if (button) { up(button); done('recording'); } else if (performance.now() - t0 > 10000) done('no REC button'); else setTimeout(press, 200); };
  press();
`;

/** Wait for REC 30 S's summary (Perf.ts writes it into the panel's .ws-perf-rec-out), close the panel and return it. */
const recRead = `
  const done = arguments[arguments.length - 1];
  const t0 = performance.now();
  const read = () => {
    const text = document.querySelector('.ws-perf-rec-out')?.textContent ?? '';
    if (/PERF REC/u.test(text) || performance.now() - t0 > 40000) {
      const root = document.querySelector('.ws-perf');
      if (root?.querySelector('.ws-perf-panel.open')) root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      done(text || 'no REC summary');
    } else setTimeout(read, 500);
  };
  read();
`;

/** Play `slug`'s route on a driver at control, one leg at a time.
 * @param {{ evaluateAsync: (script: string, args: unknown[], timeoutMs: number) => Promise<any> }} driver
 * @param {{ slug: string, cap: 30 | 60 | null, rec?: string[], legs?: number, log?: (line: string) => void,
 *   probe?: { start: string, stop: string }, heapAt?: string[], busy?: boolean }} options probe: page scripts run around each leg (route-bench --fenced-gpu); stop's value is the leg's `probe`.
 *   heapAt: legs after which the driver (`heapSnapshot`, the iPhone's Web Inspector) sums the live JavaScript heap (DF18) */
export async function playRoute(driver, { slug, cap, rec = [], legs: count, log = () => undefined, probe, heapAt = [], busy = true }) {
  const legs = [];
  // the grid's sky-down reveal (grid/reveal.ts: the camera comes down from ~400 m over the pier, 3 s) runs after control;
  // the route measures play, so it starts once the reveal has ended, and says how long the reveal took
  // DF8 (mini-driftwood13f): `--rec reveal` starts REC 30 S before the reveal, so its spike frames cover the reveal and the
  // first leg's opening (the dock's ~2 s frame is a game update inside the reveal); it is read after the first leg
  const revealRec = rec.includes('reveal');
  if (revealRec) log(`reveal: REC ${String(await driver.evaluateAsync(recStart, [], 15_000))}`);
  const reveal = await driver.evaluateAsync(revealEnd, [], 20_000).catch((/** @type {unknown} */ error) => ({ error: String(error) }));
  log(`reveal: ${JSON.stringify(reveal)}`);
  for (const leg of routeFor(slug).slice(0, count)) {
    // DW2: the game's own REC 30 S (perfHud.ts: every frame's update by system, render and gpu~, and the top spike frames
    // with their causes) over this leg; the Developer panel is open while it records, so these legs are not DW1's numbers
    const recording = rec.includes(leg.name) || (revealRec && legs.length === 0);
    const startRec = rec.includes(leg.name) && !(revealRec && legs.length === 0);
    if (startRec) log(`${leg.name}: REC ${String(await driver.evaluateAsync(recStart, [], 15_000))}`);
    if (probe !== undefined) await driver.evaluateAsync(`const done = arguments[arguments.length - 1]; done((() => { ${probe.start} })());`, [], 15_000);
    const result = await driver.evaluateAsync(`
      const done = arguments[arguments.length - 1];
      (${routeLegOnPage.toString()})(arguments[0]).then(done, (error) => done({ error: String(error) }));
    `, [{ ...leg, cap, busy }], (leg.seconds + 45) * 1000);
    // a stop body may return a promise (route-bench --leg-shots waits for the next drawn frame)
    const probed = probe === undefined ? undefined : await driver.evaluateAsync(`const done = arguments[arguments.length - 1]; Promise.resolve((() => { ${probe.stop} })()).then(done, (error) => done({ error: String(error) }));`, [], 15_000)
      .catch((/** @type {unknown} */ error) => ({ error: String(error) }));
    const summary = result?.samples?.length ? legSummary(result.samples) : null;
    const recText = recording ? await driver.evaluateAsync(recRead, [], 45_000).catch((/** @type {unknown} */ error) => `REC unread: ${String(error)}`) : null;
    const snapshot = /** @type {{ heapSnapshot?: () => Promise<unknown> }} */ (driver).heapSnapshot;
    const heap = heapAt.includes(leg.name) && typeof snapshot === 'function'
      ? await snapshot.call(driver).catch((/** @type {unknown} */ error) => ({ error: String(error) })) : undefined;
    legs.push({ name: leg.name, kind: leg.kind, cap, error: result?.error ?? null, nav: result?.nav ?? null, summary, samples: result?.samples ?? [], rec: recText,
      ...(probed === undefined ? {} : { probe: probed }), ...(heap === undefined ? {} : { heap }) });
    log(`${leg.name}: ${summary === null ? `no frames (${String(result?.error)})` : `${String(summary.fps)} fps p95 ${String(summary.p95Ms)} ms >50 ${String(summary.over50)}`}${result?.nav?.stuck?.length ? ` stuck ${String(result.nav.stuck.length)}` : ''}`);
    if (result?.error) {
      // the coordinator, 2026-11-19: a broken leg brings back the page's console errors with their stacks and the error card
      const page = await driver.evaluateAsync(`arguments[arguments.length - 1]({ errors: window.__phoneBenchErrors ?? null,
        card: document.querySelector('.ws-load-error')?.innerText?.trim() ?? null, build: window.__WS_BUILD_LABEL__ ?? null })`, [], 10_000)
        .catch((/** @type {unknown} */ error) => ({ unread: String(error) }));
      legs[legs.length - 1].page = page;
      log(`${leg.name}: page errors ${JSON.stringify(page).slice(0, 4000)}`);
    }
    if (result?.error === 'the page lost the controlled world during the leg' || result?.error === 'cannot run a route leg before control') break;
  }
  return legs;
}

/** The route's markdown table: one row per leg. Pure.
 * @param {{name:string, cap:number|null, error:string|null, summary: ReturnType<typeof legSummary> | null, nav: any}[]} legs */
export function routeTable(legs) {
  const head = '| Segment | Cap | s | fps | p50 | p95 | max | >33 | >50 | >50/30 s | upd p50/p95 | rnd p50/p95 | gpu~ p95 | delay / phase error | receipt spacing error p95/max | tris | draws | progs | tex/buf up, reads | textures | mem | audio live end/max, starts/s | stuck |';
  const rows = legs.map(({ name, cap, error, summary: s, nav }) => s === null ? `| ${name} | ${String(cap)} | ${String(error)} |` :
    `| ${name} | ${String(cap)} | ${String(s.seconds)} | ${String(s.fps)} | ${String(s.p50Ms)} | ${String(s.p95Ms)} | ${String(s.maxMs)} | ${String(s.over33)} | ${String(s.over50)} | ${String(s.over50Per30s)} | ` +
    `${String(s.updateP50Ms)} / ${String(s.updateP95Ms)} | ${String(s.renderP50Ms)} / ${String(s.renderP95Ms)} | ${String(s.gpuApproxP95Ms)} | ${String(s.delayMs)} / ${String(s.jitterMs)} | ${s.receiptSpacingP95Ms ?? '—'} / ${s.receiptSpacingMaxMs ?? '—'} | ` +
    `${s.trianglesP95 === null ? '—' : `${String(Math.round(s.trianglesP95 / 1000))}k`} | ${String(s.drawsP95)} | ${String(s.programsMax)} | ${String(s.texUploads)}/${String(s.bufUploads)}, ${String(s.readBacks)} | ${String(s.texturesMin)}–${String(s.texturesMax)} | ${s.mem ?? '—'} | ${String(s.audioLiveEnd)}/${String(s.audioLiveMax)}, ${String(s.audioStartsPerS)} | ${String(nav?.stuck?.length ?? 0)}${nav?.skipped ? ` (${String(nav.skipped)} skipped)` : ''} |`);
  return [head, `|${'---|'.repeat(23)}`, ...rows].join('\n');
}

/** The worst segment over every run of a cap: the highest p95, then the most spikes over 50 ms per 30 s.
 * @param {{ legs: { name: string, cap: number|null, summary: any }[] }[]} report @param {number} cap */
export function worstSegment(report, cap) {
  /** @type {Map<string, {p95: number[], over50: number[], fps: number[]}>} */
  const byName = new Map();
  for (const run of report) for (const leg of run.legs) {
    if (leg.cap !== cap || leg.summary === null) continue;
    const row = byName.get(leg.name) ?? { p95: [], over50: [], fps: [] };
    row.p95.push(leg.summary.p95Ms); row.over50.push(leg.summary.over50Per30s); row.fps.push(leg.summary.fps);
    byName.set(leg.name, row);
  }
  const median = (/** @type {number[]} */ list) => [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) / 2)] ?? 0;
  return [...byName.entries()].map(([name, row]) => ({ name, p95Ms: median(row.p95), over50Per30s: median(row.over50), fps: median(row.fps), runs: row.p95.length }))
    .sort((a, b) => b.p95Ms - a.p95Ms || b.over50Per30s - a.over50Per30s);
}
