/**
 * G782: per-object render callbacks (`onBeforeRender` and kin) that are draw-neutral. Such a callback only sets
 * uniforms, instance counts or flags: it never changes the geometry's vertex layout, the material's program or the draw
 * kind, so the draw it precedes builds exactly the pipeline its object, material and geometry name. A parked warm
 * (`parkedDraws.ts`) then paces its drawable like any copy of an already built pipeline. A callback that can change the
 * draw (painterly's vertex-colour hook adds a colour attribute) is left unmarked and keeps a first use of its own.
 */
const neutral = new WeakSet();

/** Declare `hook` draw-neutral and return it (for assignment in place). */
export function drawNeutral<F extends object>(hook: F): F {
  neutral.add(hook);
  return hook;
}

/** Whether `hook` was declared draw-neutral. */
export function isDrawNeutral(hook: unknown): boolean {
  return typeof hook === 'function' && neutral.has(hook);
}
