import sharp from 'sharp';
import { captureBootFrame } from './black-frame.mjs';
import { captureViewportPng } from './fast-png.mjs';

export const NIGHTLY_FRAME_LIMIT = 120;
export const NIGHTLY_WALL_MS = 90_000;

/** Run in the page, starting at the current rendered frame.
 * @param {{draws:number, frames:number, wallMs:number}} budget */
export function observeNightlyFrames(budget) {
  const game = window.__wildshard?.world?.game;
  if (game === undefined) throw new Error('Nightly frame proof has no live game');
  const start = game.frameCount;
  /** @type {number[]} */ const samples = [];
  let last = start, raf = 0;
  /** @type {(outcome:{error:string|null, samples:number[]})=>void} */
  let finish = () => undefined;
  /** @type {Promise<{error:string|null,samples:number[]}>} */
  const result = new Promise(resolve => { finish = resolve; });
  /** @param {string|null} error */
  const complete = error => { cancelAnimationFrame(raf); finish({ error, samples }); };
  const timer = setTimeout(() => complete(`Nightly frame proof exceeded ${budget.wallMs / 1000} s`), budget.wallMs);
  /** @param {string|null} error */
  const stop = error => { clearTimeout(timer); complete(error); };
  const tick = () => {
    const frame = game.frameCount;
    if (game !== window.__wildshard?.world?.game) { stop('Game changed during nightly frame proof'); return; }
    if (frame - start > budget.frames) { stop(`Nightly frame proof exceeded ${budget.frames} rendered frames`); return; }
    if (budget.draws > 0 && frame > last && game.lastFrame.calls > 0) {
      last = frame;
      samples.push(game.lastFrame.calls);
      if (samples.length === budget.draws) { stop(null); return; }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { result, stop: () => stop(null) };
}

/** @template T
 * @param {import('playwright').Page} page @param {number} draws
 * @param {(result:Promise<{error:string|null,samples:number[]}>)=>Promise<T>} run
 * @returns {Promise<T>} */
async function withFrameObserver(page, draws, run) {
  let timer;
  const wallError = new Error(`Nightly frame proof exceeded ${NIGHTLY_WALL_MS / 1000} s`);
  let expired = false;
  /** @type {Promise<never>} */
  const wallLimit = new Promise((_resolve, reject) => {
    timer = setTimeout(() => { expired = true; reject(wallError); }, NIGHTLY_WALL_MS);
  });
  const observe = async () => {
    const watch = await page.evaluateHandle(observeNightlyFrames, { draws, frames: NIGHTLY_FRAME_LIMIT, wallMs: NIGHTLY_WALL_MS });
    try {
      if (expired) throw wallError;
      return await run(watch.evaluate(observer => observer.result));
    } finally {
      // The context owner closes the page even if its renderer cannot answer.
      const dispose = async () => {
        await watch.evaluate(observer => observer.stop()).catch(() => undefined);
        await watch.dispose().catch(() => undefined);
      };
      void dispose();
    }
  };
  try { return await Promise.race([observe(), wallLimit]); }
  finally { clearTimeout(timer); }
}

/** Exactly 30 positive draw-call samples from distinct new frames.
 * @param {import('playwright').Page} page */
export function nightlyDrawSamples(page) {
  return withFrameObserver(page, 30, async result => {
    const { error, samples } = await result;
    if (error !== null) throw new Error(`${error}; ${samples.length} of 30 completed draw frames`);
    return samples;
  });
}

/** Judge the real screenshot bytes without a round trip through the loaded renderer.
 * Match the boot check's 192px analysis width, sparse RGB samples and near-black threshold.
 * @param {import('node:buffer').Buffer} bytes
 * @returns {Promise<import('./black-frame.mjs').FrameSample>} */
export async function nightlyCapturePixels(bytes) {
  const image = sharp(bytes);
  const { width, height } = await image.metadata();
  const { data } = await image.resize({ width: Math.min(192, width), kernel: 'linear' }).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  let pixels = 0, dark = 0;
  for (let at = 0; at < data.length; at += 16) {
    pixels++;
    if (Math.max(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0) < 16) dark++;
  }
  return { width, height, pixels, darkShare: dark / pixels };
}

/** Keep the real composited PNG and its pixel check, with the nightly frame budget.
 * @param {import('playwright').Page} page @param {string} label
 * @param {import('./black-frame.mjs').BootFrameSample[]} frames */
export function captureNightlyBootFrame(page, label, frames) {
  const deadline = Date.now() + NIGHTLY_WALL_MS;
  return withFrameObserver(page, 0, result => {
    const limit = result.then(({ error }) => { throw new Error(`${label}: ${error ?? 'frame observer stopped'}`); });
    // The monitor can refuse while capture tracing is still opening.
    void limit.catch(() => undefined);
    return captureBootFrame(page, label, deadline, frames,
      (target, name, end) => captureViewportPng(target, name, end, undefined, limit), NIGHTLY_WALL_MS, nightlyCapturePixels);
  });
}
