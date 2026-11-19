import { bootTimelineEntries } from '../../loading-flow/stalls.mjs';
import { pageWalk, routeFor, WALK_ROUTES } from '../walk.mjs';

/** In the page, take the engine's last second of drawn frames, not rAF callbacks.
 * @param {{seconds: number, walk: boolean, name: string, route: import('../walk.mjs').Route}} options
 * @param {typeof pageWalk} walk */
async function sampleOnPage(options, walk) {
  const world = Reflect.get(window, '__wildshard')?.world;
  if (!world || !world.hud.entered || world.hud.paused || !world.game.frameGate()) {
    throw new Error('cannot sample frames before control');
  }
  const game = world.game, started = performance.now();
  let seen = game.frameCount, previous = started;
  const runningWalk = options.walk ? walk(options) : null;
  /** @type {{ tMs: number; seconds: number; frames: number; frameMs: number[]; gpuApproxMs: number[]; updateMs: number[];
   * renderMs: number[]; draws: number; triangles: number; programs: number | null; net: string | null }[]} */
  const samples = [];
  const until = started + options.seconds * 1000;
  while (previous < until) {
    await new Promise((resolve) => { setTimeout(resolve, Math.min(until - previous, 1000)); });
    if (world !== Reflect.get(window, '__wildshard')?.world || document.visibilityState !== 'visible') {
      throw new Error('the phone lost the controlled world during frame sampling');
    }
    const now = performance.now(), frames = game.frameCount - seen;
    const frameMs = [], gpuApproxMs = [], updateMs = [], renderMs = [];
    seen = game.frameCount;
    for (let k = Math.min(frames, game.frameMs.length); k >= 1; k--) {
      const i = (game.frameI - k + game.frameMs.length) % game.frameMs.length;
      frameMs.push(game.frameMs[i]);
      updateMs.push(game.updateMs[i]); renderMs.push(game.renderMs[i]);
      gpuApproxMs.push(Math.max(0, game.frameMs[i] - Math.max(game.updateMs[i] + game.renderMs[i], 1000 / 30)));
    }
    // the worker client's wire line (Developer panel), every 5 s: delay and jitter of the server's snapshots
    const net = samples.length % 5 === 0 ? /delay [\d.]+ ms\s+jitter [\d.]+ ms/u.exec(document.body.textContent)?.[0] ?? null : null;
    samples.push({
      tMs: now - started, seconds: (now - previous) / 1000, frames, frameMs, gpuApproxMs, updateMs, renderMs,
      draws: game.lastFrame.calls, triangles: game.lastFrame.triangles, programs: game.renderer.info?.programs?.length ?? null, net,
    });
    previous = now;
  }
  const device = JSON.parse(localStorage.getItem('wildshard.save.v2@2.device') ?? '{}').keys;
  const settings = JSON.parse(localStorage.getItem('wildshard.save.v2@2.global') ?? '{}').keys?.settings?.data;
  const lowPower = JSON.parse(sessionStorage.getItem('wildshard.save.v2@2.session') ?? '{}').keys?.['boot.lowPower']?.data;
  return {
    samples, walk: runningWalk === null ? null : await runningWalk.done,
    deviceDpr: devicePixelRatio, renderDpr: game.renderer.getPixelRatio(),
    tier: settings?.tier ?? null, preset: device?.graphics?.data ?? null, lowPower: lowPower ?? null,
  };
}

/** @typedef {Awaited<ReturnType<typeof sampleOnPage>>['samples'][number]} FrameSecond */
/** @param {number[]} values @param {number} q */
export function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)] ?? null;
}

/** @param {FrameSecond[]} samples */
export function frameSummary(samples) {
  const seconds = samples.reduce((sum, sample) => sum + sample.seconds, 0);
  const count = samples.reduce((sum, sample) => sum + sample.frames, 0);
  const frame = samples.flatMap((sample) => sample.frameMs);
  return {
    fps: seconds > 0 ? count / seconds : null, p50Ms: percentile(frame, .5), p95Ms: percentile(frame, .95),
    gpuApproxP95Ms: percentile(samples.flatMap((sample) => sample.gpuApproxMs), .95),
    drawsP95: percentile(samples.map((sample) => sample.draws), .95),
    trianglesP95: percentile(samples.map((sample) => sample.triangles), .95),
    maxMs: frame.length === 0 ? null : Math.max(...frame), over50: frame.filter((ms) => ms > 50).length,
    updateP50Ms: percentile(samples.flatMap((sample) => sample.updateMs ?? []), .5),
    updateP95Ms: percentile(samples.flatMap((sample) => sample.updateMs ?? []), .95),
    renderP50Ms: percentile(samples.flatMap((sample) => sample.renderMs ?? []), .5),
    renderP95Ms: percentile(samples.flatMap((sample) => sample.renderMs ?? []), .95),
    programsP95: percentile(samples.map((sample) => sample.programs ?? 0), .95),
  };
}

/** @param {import('./safari.mjs').Safari} driver
 * @param {{ slug: string, seconds: number, walk?: boolean }} options */
export async function readFrames(driver, { slug, seconds, walk = false }) {
  const name = routeFor(slug);
  const spans = await driver.evaluate(`return (${bootTimelineEntries.toString()})();`);
  const capture = /** @type {Awaited<ReturnType<typeof sampleOnPage>> | {error: string}} */ (await driver.evaluateAsync(`
    const done = arguments[arguments.length - 1];
    (${sampleOnPage.toString()})(arguments[0], ${pageWalk.toString()})
      .then(done, (error) => done({ error: error.message }));
  `, [{ seconds, name, route: WALK_ROUTES[name] ?? null, walk }], seconds * 1000 + 15_000));
  if ('error' in capture) throw new Error(capture.error);
  if (capture.samples.every((sample) => sample.frames === 0)) throw new Error('the phone drew no controlled frames');
  return { ...capture, spans, summary: frameSummary(capture.samples) };
}
