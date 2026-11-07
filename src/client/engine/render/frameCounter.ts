/**
 * The engine's own render counter (SHARD-PLATFORM SF59 step 2, fix 2; `docs/design/mmo/research/sf59-tsl-spike.md`
 * §2.3).
 *
 * three's `renderer.info.render.frame` counts `renderer.render()` calls, but three's node handler (the TSL back-end NF18
 * retired) also bumped it once per node-material draw to refresh its uniform buffers. So once a graph material was on
 * screen, a reader that took it as "one per render" (the Memory saver's release timing, a shard's once-per-render
 * placement) ran once per draw. The engine counts renders itself instead: `renderCount(renderer)` advances exactly once
 * per `renderer.render()` call, whatever is drawn, and has the value three's counter has with only classic materials on
 * screen (both start at 0 and step at the start of a render, before any draw; every graph is a classic program since
 * NF18).
 */
import type { Renderer } from './renderer';

/** what the counter needs of a renderer (the game's `Renderer`, or a test's stand-in) */
export type Renders = Pick<Renderer, 'render'>;

const counts = new WeakMap<object, { n: number }>();

/** Borrow the existing scalar counter without installing another render hook. */
export function renderCounter(renderer: object): Readonly<{ n: number }> | undefined { return counts.get(renderer); }

/**
 * Start counting this renderer's renders (createRenderer does it for the game's renderer). Idempotent. It wraps
 * `renderer.render`; anything that wraps `render` after it still counts.
 */
export function installFrameCounter(renderer: Renders): void {
  if (counts.has(renderer)) return;
  const count = { n: 0 };
  counts.set(renderer, count);
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    count.n++;
    render(scene, camera);
  };
}

/**
 * How many times this renderer has rendered (`renderer.render()` calls, not draws). Read it where three's
 * `renderer.info.render.frame` was read. A renderer nobody installed starts counting at its first read.
 */
export function renderCount(renderer: Renders): number {
  const count = counts.get(renderer);
  if (count !== undefined) return count.n;
  installFrameCounter(renderer);
  return 0;
}
