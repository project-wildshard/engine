/// <reference path="./init.d.mts" />
import { advance } from './frames.mjs';

/** Init script: count the page's in-flight audio work (audio file reads, Cache Storage reads, digests, decodes, and the
 * idle-callback slices that render synth voices before a zoned mix builds).
 * Serialized into the page by `context.addInitScript`, so it closes over nothing. Every m5 sound baseline was recorded
 * with the muted graph built during load (until 310110541, G325), so the beds had started and the deferred phone bank had
 * landed before the walk; `settleAudio` waits for the same state on today's builds instead of racing it. */
export function installAudioWork() {
  /** @type {{inflight:number,started:number,builtAt?:number}} */
  const work = { inflight: 0, started: 0 };
  window.__parityAudioWork = work;
  const audioUrl = (/** @type {RequestInfo|URL} */ input) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return /\/assets\/(music|sfx|audio)\//.test(new URL(href, location.href).pathname);
  };
  /** @template T @param {Promise<T>} promise @returns {Promise<T>} */
  const track = (promise) => {
    work.inflight++; work.started++;
    return promise.finally(() => { work.inflight--; });
  };
  const audioBodies = new WeakSet();
  const rawFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (!audioUrl(input)) return rawFetch(input, init);
    return track(rawFetch(input, init).then((response) => { audioBodies.add(response); return response; }));
  };
  // oxlint-disable-next-line typescript/unbound-method -- native methods are saved and invoked with Reflect.apply on their receiver
  const rawBody = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = function arrayBuffer() {
    const read = Reflect.apply(rawBody, this, []);
    return audioBodies.has(this) ? track(read) : read;
  };
  if (typeof CacheStorage !== 'undefined') {
    // oxlint-disable-next-line typescript/unbound-method -- see above
    const rawMatch = CacheStorage.prototype.match;
    CacheStorage.prototype.match = /** @this {CacheStorage} @param {RequestInfo|URL} request @param {MultiCacheQueryOptions} [options] @returns {Promise<Response|undefined>} */ function match(request, options) {
      const hit = Reflect.apply(rawMatch, this, [request, options]);
      return audioUrl(request) ? track(hit.then((/** @type {Response|undefined} */ response) => { if (response) audioBodies.add(response); return response; })) : hit;
    };
  }
  // oxlint-disable-next-line typescript/unbound-method -- see above
  const rawDigest = SubtleCrypto.prototype.digest;
  SubtleCrypto.prototype.digest = /** @this {SubtleCrypto} @param {AlgorithmIdentifier} algorithm @param {BufferSource} data @returns {Promise<ArrayBuffer>} */ function digest(algorithm, data) { return track(Reflect.apply(rawDigest, this, [algorithm, data])); };
  // oxlint-disable-next-line typescript/unbound-method -- see above
  const rawDecode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = /** @this {BaseAudioContext} @param {ArrayBuffer} bytes @param {DecodeSuccessCallback|null} [ok] @param {DecodeErrorCallback|null} [fail] @returns {Promise<AudioBuffer>} */ function decodeAudioData(bytes, ok, fail) { return track(Reflect.apply(rawDecode, this, [bytes, ok, fail])); };
  // Voices.prewarm renders one variant per idle slice and Driftwood's mix builds only when its families are rendered;
  // with game frames held the browser is idle, so these run in wall time like the decodes. A slice that queues the next
  // one counts it before its own count is released.
  if (typeof window.requestIdleCallback === 'function') {
    const rawIdle = window.requestIdleCallback.bind(window), rawCancel = window.cancelIdleCallback.bind(window), live = new Set();
    window.requestIdleCallback = (callback, options) => {
      work.inflight++; work.started++;
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- requestIdleCallback is the browser API being counted
      const id = rawIdle((deadline) => { live.delete(id); try { callback(deadline); } finally { work.inflight--; } }, options);
      live.add(id);
      return id;
    };
    window.cancelIdleCallback = (id) => { if (live.delete(id)) work.inflight--; rawCancel(id); };
  }
}

/** In the page: wait (wall time, no game frames) until no audio work is in flight and none started for `quiet` native
 * macrotasks and three native animation frames in a row (a deferred decode chain yields one macrotask between files; the
 * post-boot decode starts from a frame callback). Returns the started count. */
export async function waitAudioIdle(/** @type {number} */ quiet) {
  // performance.now is the held capture clock once the world is up; the deadline is wall time
  const work = window.__parityAudioWork, control = window.__parity, deadline = Date.now() + 30_000;
  const macrotask = () => new Promise((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => { resolve(undefined); }; channel.port2.postMessage(null); });
  const frame = () => new Promise((resolve) => { control.rawRAF(() => { resolve(undefined); }); });
  let calm = 0, frames = 0, seen = work.started;
  while (calm < quiet || frames < 3) {
    if (Date.now() > deadline) throw new Error(`infrastructure: audio work still in flight after 30 s (${work.inflight})`);
    const native = calm >= quiet;
    await (native ? frame() : macrotask());
    if (work.inflight === 0 && work.started === seen) { calm++; if (native) frames++; } else { calm = 0; frames = 0; seen = work.started; }
  }
  return work.started;
}

/** Build the muted graph as the world appears (what `?mute` did during load until 310110541, G325) and remember the frame.
 * @param {import('playwright').Page} page */
export async function buildMutedGraph(page) {
  await page.evaluate(() => {
    const game = window.__wildshard.requireWorld().game;
    window.__wildshard.requireWorld().audio.master.disconnect();
    window.__parityAudioWork.builtAt = Number(Reflect.get(game, 'frameNo'));
  });
}

/** Let the level's audio settle before the walk records it. First the wall-time work in flight (the deferred phone bank,
 * bed decodes, voice renders) lands with no game frame run. If the graph has had a second of frames already (a full
 * capture's poses), that is all: running more would move every frame-driven scheduler off the baseline. Otherwise (a
 * walk-only capture, built just now) game frames run in fixed rounds (the zone mixes tick at 10 Hz) and, between rounds,
 * the work those frames asked for lands; done after a round that asked for nothing. The frame count depends only on the
 * chain of requests, never on how long a decode took.
 * @param {import('playwright').Page} page @returns {Promise<number>} the frames run */
export async function settleAudio(page) {
  const ROUND = 10, QUIET = 8, HAD = 30;
  let started = await page.evaluate(waitAudioIdle, QUIET);
  const since = await page.evaluate(() => Number(Reflect.get(window.__wildshard.requireWorld().game, 'frameNo')) - (window.__parityAudioWork.builtAt ?? Infinity));
  if (since >= HAD) return 0;
  for (let round = 1; round <= 12; round++) {
    await advance(page, ROUND);
    const now = await page.evaluate(waitAudioIdle, QUIET);
    if (now === started) return round * ROUND;
    started = now;
  }
  throw new Error('infrastructure: level audio kept starting work after 12 rounds');
}
