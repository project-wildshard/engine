import type { BootTiming } from '../../../shared/engine/boot/timing';

/** QA-FEEDBACK-2026-11-23 row 10 (from row 8: Jake's update boot on his iPhone 17 Pro could not be read, no per-step boot
 *  time was kept anywhere). Each boot's steps go out on the session summary the heartbeat already carries, so the
 *  telemetry store holds them per device class beside the build.
 *
 *  - `update`: the first boot of a build on this device after another build reached control here; `normal`: the same build
 *    again; `first`: no build reached control here before (a new install, or storage cleared).
 *  - Steps, in ms: `page` (navigation to the boot loader's end: the splash), `control` (navigation to first control), and
 *    every loading stage by its key (`stage:<key>`, the loading card's rows: `home`, `shaders`, `homePrograms`, `finish`,
 *    `level.world`, ...), each its longest span. `serviceWorker` is 1 when a service worker controlled the page. */
export type BootKind = 'first' | 'update' | 'normal';
const BOOT_STEP_KEY = /^[a-zA-Z][a-zA-Z0-9.]{0,31}$/u;
/** A step key the server stores: a stage key, at most 32 characters. */
export function isBootStepKey(key: string): boolean { return BOOT_STEP_KEY.test(key); }
export const MAX_BOOT_STEPS = 64;
/** The longest a step can read (20 min, the server's own cap on a boot). */
export const MAX_BOOT_STEP_MS = 1_200_000;

export function bootKind(previous: string | null, build: string): BootKind {
  return previous === null || previous === '' ? 'first' : previous === build ? 'normal' : 'update';
}

/** The boot's step times from the page's boot timing collector (index.html's `__bootTiming`). */
export function bootStepTimes(timing: Pick<BootTiming, 'entries' | 'serviceWorker'> | undefined): Record<string, number> {
  const steps: Record<string, number> = {};
  if (timing === undefined) return steps;
  let count = 0;
  const put = (key: string, ms: number): void => {
    if (!BOOT_STEP_KEY.test(key) || !Number.isFinite(ms) || ms < 0) return;
    const value = Math.min(MAX_BOOT_STEP_MS, Math.round(ms));
    if (key in steps) { steps[key] = Math.max(steps[key] ?? 0, value); return; }
    if (count >= MAX_BOOT_STEPS) return;
    steps[key] = value; count++;
  };
  let page: number | undefined, control: number | undefined;
  for (const entry of timing.entries) {
    if (entry.operation === 'app:loader-complete') page ??= entry.start;
    else if (entry.operation === 'app:control-ready') control ??= entry.start;
  }
  if (page !== undefined) put('page', page);
  if (control !== undefined) put('control', control);
  if (timing.serviceWorker !== undefined) put('serviceWorker', typeof timing.serviceWorker['controller'] === 'string' ? 1 : 0);
  for (const entry of timing.entries)
    if (entry.operation.startsWith('stage:') && entry.end !== null) put(entry.operation.slice('stage:'.length), entry.end - entry.start);
  return steps;
}
