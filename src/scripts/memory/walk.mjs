// MEMORY-STRUCTURE STR18 (meta docs/plans/MEMORY-STRUCTURE-PLAN.md): the walk meter. After control on the online boot the
// player walks a fixed route for 60 s with no forced collection, and two readings come back:
//   - WebKit [K]: the WebContent (and GPU-process) peak over the walk above the settled reading (measure.mjs's two GCs,
//     2 s idle, median of five reads). This is the swing a phone in play carries and the settled reading hides.
//   - Chromium [S]: sampled allocation traffic over the same walk (V8's sampling heap profiler, objects collected by
//     minor and major GCs included), as MB/s and by stack. Traffic, never a peak.
// The route: `nine` follows Nine Dragon's streets (benchmax.mjs NB8's waypoints: the square, the south street to z -95 and
// back, the stair street to x 36 and back), on foot, looped; `spin` (every other zone) walks forward turning 0.5 rad/s, so
// the camera sweeps the whole view every 12.6 s. A player under 1 m in a second skips to the next waypoint (spin: turns a
// quarter); the online client cannot teleport, so a stuck walk is counted, never hidden.
import { setTimeout as sleep } from 'node:timers/promises';

/** @typedef {{points: [number, number][], reach: number} | null} Route */
/** @type {Readonly<Record<string, Route>>} */
export const WALK_ROUTES = Object.freeze({
  spin: null,
  nine: { reach: 4, points: [[3, -20], [6, -60], [5, -95], [6, -60], [3, -20], [3, 3], [20, 5], [36, 5], [20, 5], [3, 3]] },
});

/** STR19: an engine owner frame that is the placed culler: every function of cull.ts, place.ts's frame pass (`cullPlaced`,
 *  `cullPass`, `castingFrusta`) and the world scene's residency test (`residentCopies`, its `has`). Placing a streamed
 *  tile's copies (place.ts's builders, worldScenePlacement's `posed`) is loading, not the per-frame culler. */
export const CULLER = /^(?:\S+ src\/client\/engine\/models\/cull\.ts|(?:cullPlaced|cullPass|castingFrusta) src\/client\/engine\/models\/place\.ts|(?:has|residentCopies) src\/client\/game\/shardfile\/worldScenePlacement\.ts):/u;

/** The route a zone walks: Nine its streets, every other zone the spin. @param {string} chunk */
export function routeFor(chunk) { return chunk === 'nine-dragon-stack' ? 'nine' : 'spin'; }

/** In-page: start the walk (forward held, steering every frame) and return a handle whose `done` resolves with the
 * route's record after `seconds`. Runs in the page; must not close over anything outside itself.
 * @param {{seconds: number, name: string, route: Route}} options */
export function pageWalk({ seconds, name, route }) {
  const api = /** @type {any} */ (window).__wildshard, w = api.world, input = w.game.app.input, p = w.player;
  const t0 = performance.now(), nav = { name, reached: 0, stuck: /** @type {number[][]} */ ([]), metres: 0, path: /** @type {number[][]} */ ([]), frames: 0 };
  const frames0 = w.game.frameCount;
  // the meter's own steering allocates nothing per frame (scalars, indexed reads, one rAF callback, the held key set once a
  // second): what the walk reads is the game's
  let at = 0, last = t0, prevX = p.position.x, prevZ = p.position.z, checkT = t0, checkX = prevX, checkZ = prevZ, lastPath = -1;
  /** @type {(value: typeof nav) => void} */ let finish = () => undefined;
  const done = new Promise((resolve) => { finish = resolve; });
  const step = () => {
    const now = performance.now(), s = (now - t0) / 1000, dt = Math.min(0.1, (now - last) / 1000); last = now;
    const x = p.position.x, z = p.position.z;
    nav.metres += Math.hypot(x - prevX, z - prevZ); prevX = x; prevZ = z;
    if (s >= seconds) { input.setHeld('move.forward', false); nav.frames = w.game.frameCount - frames0; nav.metres = Math.round(nav.metres); finish(nav); return; }
    if (route === null) p.yaw += 0.5 * dt;
    else {
      const point = route.points[at % route.points.length], dx = point[0] - x, dz = point[1] - z;
      if (Math.hypot(dx, dz) < route.reach) { at++; nav.reached++; }
      else {
        const want = Math.atan2(-dx, -dz), turn = ((want - p.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        p.yaw += Math.max(-4 * dt, Math.min(4 * dt, turn));
      }
    }
    if (now - checkT >= 1000) {
      // once a second: the route's record, the held key re-asserted, and a stuck player sent on
      input.setHeld('move.forward', true);
      lastPath++; nav.path.push([lastPath, Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
      if (Math.hypot(x - checkX, z - checkZ) < 1) {
        nav.stuck.push([Math.round(s * 10) / 10, Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
        if (route === null) p.yaw += Math.PI / 2; else at++;
      }
      checkT = now; checkX = x; checkZ = z;
    }
    requestAnimationFrame(step);
  };
  input.setHeld('move.forward', true);
  step();
  return { done };
}

/** Walk `chunk`'s route on `page` for `seconds` (Playwright page at control). @param {any} page @param {string} chunk @param {number} seconds */
export async function walkRoute(page, chunk, seconds) {
  const name = routeFor(chunk), route = WALK_ROUTES[name] ?? null;
  const handle = await page.evaluateHandle(pageWalk, { seconds, name, route });
  try {
    // the page's timers can be throttled; wait from outside, then for the walk's own end
    await sleep(seconds * 1000);
    return /** @type {{name:string, reached:number, stuck:number[][], metres:number, path:number[][], frames:number}} */ (
      await handle.evaluate((/** @type {any} */ h) => h.done));
  } finally { await handle.dispose(); }
}

/** @typedef {{functionName:string, url:string, lineNumber:number, columnNumber:number}} CallFrame */
/** @typedef {{callFrame: CallFrame, selfSize: number, children: ProfileNode[]}} ProfileNode */

/** A frame as `name file:line:col` (1-based), the file without its hash directory, or through `symbol` (a built client's
 * source maps, `symbolizer`) as `name src/file.ts:line` when it resolves. @param {CallFrame} f
 * @param {((f: CallFrame) => string | null)} [symbol] */
export function frameName(f, symbol) {
  const resolved = symbol?.(f) ?? null;
  if (resolved !== null) return resolved;
  const file = f.url === '' ? '(page script)' : f.url.split('/').pop()?.split('?')[0] ?? f.url;
  return `${f.functionName === '' ? '(anonymous)' : f.functionName} ${file}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
}

/** Resolve a page's frames through the built client folder `dist`'s hidden source maps (`<file>.js.map` beside each chunk):
 * `fn src/path.ts:line`, the function the map names at that position, else the frame's own name.
 * @param {string} dist @returns {Promise<(f: CallFrame) => string | null>} */
export async function symbolizer(dist) {
  const fs = await import('node:fs'), path = await import('node:path');
  const traceMapping = await import('@jridgewell/trace-mapping');
  /** @type {Map<string, any>} */ const maps = new Map();
  return (f) => {
    if (!/^https?:/u.test(f.url)) return null;
    const file = path.join(dist, decodeURIComponent(new URL(f.url).pathname));
    if (!maps.has(file)) maps.set(file, fs.existsSync(`${file}.map`) ? new traceMapping.TraceMap(fs.readFileSync(`${file}.map`, 'utf8')) : null);
    const map = maps.get(file);
    if (map === null) return null;
    const o = traceMapping.originalPositionFor(map, { line: f.lineNumber + 1, column: f.columnNumber });
    if (!o.source) return null;
    const source = o.source.replace(/^.*node_modules\//u, '').replace(/^(\.\.\/)+/u, '');
    // the map's own name at the function's start (the source name; the frame's is the minified one)
    return `${o.name ?? (f.functionName === '' ? '(anonymous)' : f.functionName)} ${source}:${String(o.line)}`;
  };
}

/** A sampled allocation profile's total bytes and its sites: each leaf frame's self bytes with the stack above it
 * (innermost first, `depth` frames), the largest `top` first. Pure. @param {{head: ProfileNode}} profile
 * @param {{top?: number, depth?: number, symbol?: (f: CallFrame) => string | null}} [options] */
export function allocationSites(profile, { top = 10, depth = 4, symbol } = {}) {
  /** @type {Map<string, {bytes:number, stack:string[]}>} */ const stacks = new Map();
  /** @type {Map<string, number>} */ const frames = new Map(), owners = new Map();
  let total = 0;
  /** @type {[ProfileNode, string[]][]} */ const queue = [[profile.head, []]];
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i]; if (entry === undefined) continue;
    const [node, above] = entry;
    const name = frameName(node.callFrame, symbol), chain = node === profile.head ? [] : [name, ...above];
    if (node.selfSize > 0) {
      total += node.selfSize;
      const stack = chain.slice(0, depth), key = stack.join(' < ');
      const row = stacks.get(key) ?? { bytes: 0, stack }; row.bytes += node.selfSize; stacks.set(key, row);
      if (chain[0] !== undefined) frames.set(chain[0], (frames.get(chain[0]) ?? 0) + node.selfSize);
      // the innermost engine frame (a `src/` source): who to fix when the leaf is three.js or the runtime
      const own = chain.find((frame) => / src\//u.test(frame)) ?? chain[0] ?? '(root)';
      owners.set(own, (owners.get(own) ?? 0) + node.selfSize);
    }
    for (const child of node.children) queue.push([child, chain]);
  }
  /** @param {Map<string, number>} map */
  const ranked = (map) => [...map.entries()].map(([site, bytes]) => ({ site, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, top);
  return { total, stacks: [...stacks.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top), sites: ranked(frames), owners: ranked(owners),
    allOwners: [...owners.entries()].map(([site, bytes]) => ({ site, bytes })) };
}

/** The bytes a profile's sites matching `pattern` (a file or function) allocated. Pure.
 * @param {{head: ProfileNode}} profile @param {RegExp} pattern @param {(f: CallFrame) => string | null} [symbol] */
export function bytesMatching(profile, pattern, symbol) {
  let bytes = 0;
  /** @type {ProfileNode[]} */ const queue = [profile.head];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]; if (node === undefined) continue;
    if (node.selfSize > 0 && pattern.test(frameName(node.callFrame, symbol))) bytes += node.selfSize;
    queue.push(...node.children);
  }
  return bytes;
}

/** The walk's WebKit reading from measure's footprint stream: the peak per role over the `walk` segment, above settled.
 * @param {readonly {mark:string, peak:Record<string, number>, last:Record<string, number>}[]} segments
 * @param {readonly {pid:number, role:string}[]} procs @param {{webcontent:number, gpu:number}} settled */
export function walkPeak(segments, procs, settled) {
  const segment = segments.find((s) => s.mark === 'walk');
  if (segment === undefined || segment.samples === 0) return null;
  /** @param {Record<string, number>} values @param {string} role */
  const sum = (values, role) => procs.filter((p) => p.role === role).reduce((total, p) => total + (values[String(p.pid)] ?? 0), 0);
  const peak = { webcontent: sum(segment.peak, 'webcontent'), gpu: sum(segment.peak, 'gpu') };
  return { peak, last: { webcontent: sum(segment.last, 'webcontent'), gpu: sum(segment.last, 'gpu') },
    aboveSettled: { webcontent: peak.webcontent - settled.webcontent, gpu: peak.gpu - settled.gpu }, samples: segment.samples };
}
