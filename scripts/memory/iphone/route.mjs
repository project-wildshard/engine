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
 *   turn?: number, prey?: string, reach?: number }} RouteLeg */

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
});

/** The route for a zone, or a refusal naming the zones that have one. @param {string} slug */
export function routeFor(slug) {
  const route = ROUTES[slug];
  if (route === undefined) throw new Error(`No route for ${slug}; routes: ${Object.keys(ROUTES).join(', ')}`);
  return route;
}

/** In the page: play one leg and keep its frames per second. Must not close over anything outside itself.
 * @param {RouteLeg & { cap: 30 | 60 | null }} leg */
export function routeLegOnPage(leg) {
  const api = /** @type {any} */ (window).__wildshard, w = api?.world;
  if (!w || !w.hud.entered || w.hud.paused || !w.game.frameGate()) return Promise.resolve({ error: 'cannot run a route leg before control' });
  const game = w.game, input = game.app.input, p = w.player, renderer = game.renderer;
  // the cap: Game re-reads qualityCap every 2 s from the preset and Low Power; held here for the whole leg
  if (leg.cap !== null) {
    try { Object.defineProperty(game, 'qualityCap', { get: () => leg.cap, set: () => undefined, configurable: true }); } catch { /* read-only */ }
  }
  const clock = p.link?.client?.clock ?? null;
  const t0 = performance.now(), frames0 = game.frameCount;
  let seen = game.frameCount, previous = t0, last = t0, at = 0, metres = 0, prevX = p.position.x, prevZ = p.position.z;
  let detours = 0, detourUntil = 0, detourYaw = 0, pressedLock = 0, checkX = prevX, checkZ = prevZ, still = 0, swings = 0, target = /** @type {any} */ (null), engaged = false;
  /** @type {any[]} */ const samples = [];
  const nav = { reached: 0, stuck: /** @type {number[][]} */ ([]), skipped: 0, metres: 0, path: /** @type {number[][]} */ ([]),
    target: /** @type {unknown} */ (null), engagedAt: /** @type {number|null} */ (null) };
  const points = leg.points ?? [], reach = leg.reach ?? 3;
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
    p.yaw += Math.max(-4 * dt, Math.min(4 * dt, turn));
    return Math.abs(turn);
  };
  /** @type {(value: unknown) => void} */ let finish = () => undefined;
  const done = new Promise((resolve) => { finish = resolve; });
  let ended = false;
  const end = (/** @type {string|null} */ error) => {
    if (ended) return;
    ended = true;
    input.setHeld('move.forward', false); input.setHeld('sprint', false); input.setHeld('attack', false);
    nav.metres = Math.round(metres);
    finish({ error, samples, nav, frames: game.frameCount - frames0, ms: performance.now() - t0, cap: leg.cap,
      programs: renderer.info?.programs?.length ?? null });
  };
  const sample = (/** @type {number} */ now) => {
    const frames = game.frameCount - seen, ring = game.frameMs.length;
    const frameMs = [], updateMs = [], renderMs = [], gpuApproxMs = [];
    seen = game.frameCount;
    for (let k = Math.min(frames, ring); k >= 1; k--) {
      const i = (game.frameI - k + ring) % ring;
      frameMs.push(game.frameMs[i]); updateMs.push(game.updateMs[i]); renderMs.push(game.renderMs[i]);
      gpuApproxMs.push(Math.max(0, game.frameMs[i] - Math.max(game.updateMs[i] + game.renderMs[i], 1000 / 30)));
    }
    samples.push({ tMs: now - t0, seconds: (now - previous) / 1000, frames, frameMs, updateMs, renderMs, gpuApproxMs,
      draws: game.lastFrame.calls, triangles: game.lastFrame.triangles, programs: renderer.info?.programs?.length ?? null,
      delayMs: clock?.delayMs ?? null, jitterMs: clock?.jitterMs ?? null,
      at: [Math.round(p.position.x * 10) / 10, Math.round(p.position.z * 10) / 10] });
    previous = now;
  };
  const step = () => {
    if (ended) return;
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000), s = (now - t0) / 1000;
    last = now;
    if (w !== /** @type {any} */ (window).__wildshard?.world || document.visibilityState !== 'visible') { end('the page lost the controlled world during the leg'); return; }
    const x = p.position.x, z = p.position.z;
    metres += Math.hypot(x - prevX, z - prevZ); prevX = x; prevZ = z;
    if (now - previous >= 1000) {
      sample(now);
      nav.path.push([Math.round(s), Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
      const moved = Math.hypot(x - checkX, z - checkZ);
      checkX = x; checkZ = z;
      if (leg.kind !== 'stand' && !engaged && at < points.length && moved < 1) {
        still++;
        nav.stuck.push([Math.round(s), Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
        input.setHeld('jump', true); setTimeout(() => { input.setHeld('jump', false); }, 150);
        // a player blocked steps aside and tries again: left, then right, then wider; the waypoint is skipped after five
        if (still >= 2) { detours++; detourUntil = now + 1200; detourYaw = p.yaw + (detours % 2 === 1 ? 1 : -1) * Math.PI * (detours > 2 ? 0.75 : 0.5); }
        if (detours >= 5) { at++; nav.skipped++; detours = 0; still = 0; }
      } else still = 0;
    }
    const over = s >= leg.seconds;
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
  setTimeout(() => { end('leg overran its time'); }, (leg.seconds + 30) * 1000);
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
 *   draws:number, triangles:number, programs:number|null, delayMs:number|null, jitterMs:number|null}[]} samples */
export function legSummary(samples) {
  const seconds = samples.reduce((sum, row) => sum + row.seconds, 0);
  const frames = samples.flatMap((row) => row.frameMs);
  const over = (/** @type {number} */ ms) => frames.filter((value) => value > ms).length;
  const round = (/** @type {number|null} */ value, digits = 1) => value === null ? null : Number(value.toFixed(digits));
  return {
    seconds: round(seconds), fps: round(seconds > 0 ? samples.reduce((sum, row) => sum + row.frames, 0) / seconds : null),
    p50Ms: round(percentile(frames, 0.5)), p95Ms: round(percentile(frames, 0.95)), maxMs: round(frames.length ? Math.max(...frames) : null),
    over33: over(1000 / 30 + 0.7), over50: over(50), over50Per30s: round(seconds > 0 ? over(50) * 30 / seconds : null),
    updateP50Ms: round(percentile(samples.flatMap((row) => row.updateMs), 0.5)), updateP95Ms: round(percentile(samples.flatMap((row) => row.updateMs), 0.95)),
    renderP50Ms: round(percentile(samples.flatMap((row) => row.renderMs), 0.5)), renderP95Ms: round(percentile(samples.flatMap((row) => row.renderMs), 0.95)),
    gpuApproxP95Ms: round(percentile(samples.flatMap((row) => row.gpuApproxMs), 0.95)),
    delayMs: round(percentile(finite(samples.map((row) => row.delayMs)), 0.5), 0), delayMaxMs: round(Math.max(0, ...finite(samples.map((row) => row.delayMs))), 0),
    jitterMs: round(percentile(finite(samples.map((row) => row.jitterMs)), 0.5)), jitterMaxMs: round(Math.max(0, ...finite(samples.map((row) => row.jitterMs)))),
    trianglesP95: percentile(samples.map((row) => row.triangles), 0.95), drawsP95: percentile(samples.map((row) => row.draws), 0.95),
    programsMax: Math.max(0, ...finite(samples.map((row) => row.programs))),
  };
}

/** Play `slug`'s route on a driver at control, one leg at a time.
 * @param {{ evaluateAsync: (script: string, args: unknown[], timeoutMs: number) => Promise<any> }} driver
 * @param {{ slug: string, cap: 30 | 60 | null, log?: (line: string) => void }} options */
export async function playRoute(driver, { slug, cap, log = () => undefined }) {
  const legs = [];
  for (const leg of routeFor(slug)) {
    const result = await driver.evaluateAsync(`
      const done = arguments[arguments.length - 1];
      (${routeLegOnPage.toString()})(arguments[0]).then(done, (error) => done({ error: String(error) }));
    `, [{ ...leg, cap }], (leg.seconds + 45) * 1000);
    const summary = result?.samples?.length ? legSummary(result.samples) : null;
    legs.push({ name: leg.name, kind: leg.kind, cap, error: result?.error ?? null, nav: result?.nav ?? null, summary, samples: result?.samples ?? [] });
    log(`${leg.name}: ${summary === null ? `no frames (${String(result?.error)})` : `${String(summary.fps)} fps p95 ${String(summary.p95Ms)} ms >50 ${String(summary.over50)}`}${result?.nav?.stuck?.length ? ` stuck ${String(result.nav.stuck.length)}` : ''}`);
    if (result?.error === 'the page lost the controlled world during the leg' || result?.error === 'cannot run a route leg before control') break;
  }
  return legs;
}

/** The route's markdown table: one row per leg. Pure.
 * @param {{name:string, cap:number|null, error:string|null, summary: ReturnType<typeof legSummary> | null, nav: any}[]} legs */
export function routeTable(legs) {
  const head = '| Segment | Cap | s | fps | p50 | p95 | max | >33 | >50 | >50/30 s | upd p50/p95 | rnd p50/p95 | gpu~ p95 | delay / jitter | tris | draws | progs | stuck |';
  const rows = legs.map(({ name, cap, error, summary: s, nav }) => s === null ? `| ${name} | ${String(cap)} | ${String(error)} |` :
    `| ${name} | ${String(cap)} | ${String(s.seconds)} | ${String(s.fps)} | ${String(s.p50Ms)} | ${String(s.p95Ms)} | ${String(s.maxMs)} | ${String(s.over33)} | ${String(s.over50)} | ${String(s.over50Per30s)} | ` +
    `${String(s.updateP50Ms)} / ${String(s.updateP95Ms)} | ${String(s.renderP50Ms)} / ${String(s.renderP95Ms)} | ${String(s.gpuApproxP95Ms)} | ${String(s.delayMs)} / ${String(s.jitterMs)} | ` +
    `${s.trianglesP95 === null ? '—' : `${String(Math.round(s.trianglesP95 / 1000))}k`} | ${String(s.drawsP95)} | ${String(s.programsMax)} | ${String(nav?.stuck?.length ?? 0)}${nav?.skipped ? ` (${String(nav.skipped)} skipped)` : ''} |`);
  return [head, `|${'---|'.repeat(18)}`, ...rows].join('\n');
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
