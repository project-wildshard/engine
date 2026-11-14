/**
 * Frame pacing for builds that run while the game is drawing (op-hitch26, E435 frame floor, G294).
 *
 * A grid cell admits its world on the road, in play: every synchronous stretch of a builder lands between two drawn frames.
 * The engine's loop reports each frame it draws (`noteFrameDrawn`); while it keeps drawing, the page is *presenting*, and a
 * sliced build ends a stretch with `paceYield()`: a plain macrotask while the next frame is not yet due, or — when it is —
 * a wait until the loop has drawn one. A timer or message hop alone does not guarantee that: Blink may run several queued
 * tasks back to back before its rendering update (measured on Nine Dragon's cell entry, op-hitch23 / op-hitch26).
 *
 * Not presenting (the loading screen, a frozen title, Node bakers and tests): nothing changes, every yield is the caller's
 * own macrotask and `presenting()` is false, so a loader keeps its own budgets. Quiet frame floors back pacing on by default.
 * Pacing follows the loop's recent drawn frames; importing this module does not draw or schedule a frame.
 *
 * The drawn-frame reports are the pacing port (P1-E1): the browser loop feeds `noteFrameDrawn`, a headless host never does,
 * so it never presents and its builds keep their own yields at its fixed tick. A frame wait goes through the scope
 * environment the page installs (`framesAvailable`), so this module reads no DOM global.
 */
import type { Scope } from '../app/scope';
import { resourceScope } from '../app/resources';
import { framesAvailable } from '../app/scopeEnvironment';
import { diagnosticNow } from './clock';

/** A page that drew a frame within this long is presenting: its builds pace themselves to its frames (ms). */
const PRESENTING_MS = 250;
/** A frame counts as due this long before its interval has run out (timestamp jitter, the loop's own start-up). */
const DUE_SLACK_MS = 2;
/** A paced wait never outlasts this, whatever the loop does (a hidden page, a lost context, a gated frame). */
const WAIT_CAP_MS = 100;
/** Construction remains below half a 60 Hz display slot, even when the game draws less often. */
const BUILD_FRAME_MS = 1000 / 60;

let lastDrawn = Number.NEGATIVE_INFINITY;
let lastFrameAt = Number.NEGATIVE_INFINITY;
let lastVsyncAt = Number.NEGATIVE_INFINITY;
/** Declared capped cadence, or the fastest observed uncapped cadence; legacy completion-only calls smooth it. */
let interval = 1000 / 60;
/** G580 T5: while the traveller waits at a grid cell's wall for its build (`setBuildHeld`), a build stretch may run this
 *  long past the last drawn frame, and a due frame no longer ends it: the slower waiting frames cost no movement (ms). */
export const HELD_BUILD_MS = 24;
let held = false;
/** G782: the held view stays live 3D at 30 fps or better (Jake's bar: 60-120 desktop, 30-60 phone, at all moments), so a
 *  held frame starts at most this long after the last one did (ms). Until then, while held, the CPU build slices that share
 *  a frame (`frameBudgetSpent`) keep running, and the loop skips the vsyncs between (`heldDrawDeferred`): desktop gives
 *  them every other vsync, the phone's 30 fps cadence is unchanged. Native GPU units (shader compile, link, uploads) keep
 *  HELD_BUILD_MS (`nativeBudgetSpent`) and parked draws their own budget. */
export const HELD_FRAME_FLOOR_MS: number = 1000 / 30;
/** A held CPU slice gets at least this long after a drawn frame, however slow the frame was (ms). */
const HELD_SLICE_MIN_MS = 4;
/** When a held CPU slice last asked for the shared budget (`frameBudgetSpent`), for `heldDrawDeferred`. */
let heldSliceAt = Number.NEGATIVE_INFINITY;
/** Frames drawn while held, for `heldFrameTurn`. */
let heldFrames = 0;
/** GRID-CROSSING GC6 (QA 11-14 row 6, Jake on staging: a 37 s card crossing into Nalati at 2992x1434@2): a build the traveller
 *  is about to need (the world of the cell ahead, its entry on the road) is on the crossing's critical path. Its slices then
 *  get URGENT_BUILD_MS after each drawn frame, whatever the display's rate and whether the next vsync is due: the ordinary
 *  quarter of the fastest display interval gave a 120 Hz screen 2 ms a frame, and at 30 fps that is 6% of the wall clock, so
 *  an 11 s world took 30 s. The grid sets it while such a build runs; off by default. */
export const URGENT_BUILD_MS = 8;
let urgent = false;
export function setBuildUrgent(on: boolean): void { urgent = on; }
/** Whether a build the traveller is about to need is running (`setBuildUrgent`). */
export function buildUrgent(): boolean { return urgent; }
/** Whether the traveller waits for the build (a grid cell's loading screen shows); the grid sets it, off by default.
 *  The page sets it through `setBuildHeldTimed` (`heldTiming.ts`), which also times each held interval on Developer pages. */
export function setBuildHeld(on: boolean): void {
  held = on; heldSliceAt = Number.NEGATIVE_INFINITY;
}
/** The latest a held frame may start: HELD_FRAME_FLOOR_MS after the last drawn one started, less the due slack. A capped
 *  loop's cadence anchor (`lastFrameAt`) can precede the vsync the frame actually ran at (`lastVsyncAt`) by up to a vsync,
 *  and the next frame cannot start before the next vsync after it anyway: counting from the anchor left Pine's held slices
 *  ~10 ms idle every frame (G782), so the floor counts from the later of the two. */
const heldDeadline = (): number => Math.max(lastFrameAt, lastVsyncAt) + HELD_FRAME_FLOOR_MS - DUE_SLACK_MS;
/** A build stretch's budget: `budgetMs`, or HELD_BUILD_MS while the traveller is held. */
export function heldBudget(budgetMs: number): number { return held ? Math.max(budgetMs, HELD_BUILD_MS) : budgetMs; }
/** Whether the traveller is held at a grid cell's wall (`setBuildHeld`). */
export function buildHeld(): boolean { return held; }

/** Report completion and, when available, its rAF timestamp and active fps cap (0 = uncapped).
 * Build deadlines start at the vsync, not after the frame's work; missed vsyncs never relax an uncapped deadline.
 * `cadenceAt` is the capped loop recovery anchor: builders share its next deadline after a late frame.
 * Actual rAF stamps still determine uncapped display cadence; omitted anchors preserve the original deadline.
 * A completion-only caller retains the original smoothed interval. */
export function noteFrameDrawn(at: number = diagnosticNow(), frameAt?: number, capFps?: number, cadenceAt?: number): void {
  const start = cadenceAt ?? frameAt ?? at;
  // The synchronous first draw can land midway between vsyncs. Only two actual rAF stamps establish cadence.
  const gap = capFps === 0 ? (frameAt === undefined ? Number.POSITIVE_INFINITY : frameAt - lastVsyncAt) : start - lastFrameAt;
  if (capFps !== undefined && capFps > 0) interval = 1000 / capFps;
  else if (gap > 4 && gap < 70) interval = capFps === 0 ? Math.min(interval, gap) : interval + (gap - interval) * 0.2;
  lastVsyncAt = frameAt ?? Number.NEGATIVE_INFINITY;
  lastFrameAt = start; lastDrawn = at;
  if (held) heldFrames++;
}

/** G782: whether a per-frame system whose output does not change what a held second shows (a minimap, a slow sky curve)
 *  runs this frame: on every `every`-th drawn frame while the traveller is held (`phase` spreads several over the frames),
 *  and on every frame otherwise, so it is back at full rate the frame the hold ends. */
export function heldFrameTurn(every: number, phase = 0): boolean { return !held || heldFrames % every === phase % every; }

/** Whether the engine loop is drawing frames: a build now runs between drawn frames, in play. */
export function presenting(now: number = diagnosticNow()): boolean { return now - lastDrawn < PRESENTING_MS; }

/** Whether a presenting page's next frame is due (its interval since the last drawn frame has run out). */
export function frameDue(now: number = diagnosticNow()): boolean {
  return presenting(now) && now - lastFrameAt >= interval - DUE_SLACK_MS;
}

/**
 * Whether a presenting page's build work since its last drawn frame has used `budgetMs`, at most a quarter of the game frame and half a 60 Hz display slot: the budget is the
 * frame's, shared by every sliced build running at once. Each slice's own clock alone let several builds (a herd's coats,
 * the ground's arrays, the terrain) each run their stretch back to back, so no frame was drawn for 100-130 ms.
 */
export function frameBudgetSpent(budgetMs: number, now: number = diagnosticNow()): boolean {
  if (held) { heldSliceAt = now; return presenting(now) && now >= Math.max(heldDeadline(), lastDrawn + HELD_SLICE_MIN_MS); }
  // D110: a frame that overran its interval (drawn after the next was due: a phone at 4x CPU) is due the moment it lands,
  // so the due rule would end every slice before it starts and no sliced build would run again; after such a frame the
  // builds get their ordinary slice instead
  if (urgent) return presenting(now) && now - lastDrawn >= Math.min(budgetMs, URGENT_BUILD_MS);
  const overran = lastDrawn - lastFrameAt >= interval - DUE_SLACK_MS;
  return presenting(now) && (now - lastDrawn >= Math.min(budgetMs, interval / 4, BUILD_FRAME_MS / 2) || (!overran && frameDue(now)));
}

/** G782: whether the engine loop may skip this vsync: the traveller is held, a CPU build slice has run since the last
 *  drawn frame and the held frame floor (HELD_FRAME_FLOOR_MS) is not yet due. Held frames still cost a whole update and a
 *  draw of the nearby world (Pine's forest page: 3.1 of its 7.8 s), so a frame at every desktop vsync left the slices only
 *  the gaps between; never past the floor. */
export function heldDrawDeferred(now: number = diagnosticNow()): boolean {
  return held && heldSliceAt > lastDrawn && now < heldDeadline();
}

/** `frameBudgetSpent` for native GPU units (shader compile, link, texture uploads): held, they keep HELD_BUILD_MS past the
 *  last drawn frame, so the longer held CPU budget never joins several slow native units in one frame (G782). */
export function nativeBudgetSpent(budgetMs: number, now: number = diagnosticNow()): boolean {
  return held ? presenting(now) && now - lastDrawn >= heldBudget(budgetMs) : frameBudgetSpent(budgetMs, now);
}

/** Resolve after a later drawn frame (rAF, then a scoped task), or its cap. Retirement also settles the wait;
 * the awaiting builder must reach its own cancellation fence rather than hang on a removed frame callback. */
export function nextDrawnFrame(owner?: Scope): Promise<void> {
  const scope = owner ?? resourceScope(), since = lastDrawn, start = diagnosticNow();
  return new Promise<void>((resolve) => {
    let done = false, forget = (): void => undefined;
    let frame: number | undefined, cap: ReturnType<Scope['timeout']> | undefined, task: ReturnType<Scope['timeout']> | undefined, turn: Scope | undefined;
    const finish = (): void => {
      if (done) return;
      done = true; forget();
      if (frame !== undefined) scope.cancelRaf(frame);
      if (cap !== undefined) scope.cancelTimer(cap);
      if (task !== undefined) scope.cancelTimer(task);
      turn?.dispose(); resolve();
    };
    forget = scope.capture('disposers', finish);
    const check = (): void => {
      if (done) return;
      if (lastDrawn > since || diagnosticNow() - start >= WAIT_CAP_MS || !framesAvailable()) { finish(); return; }
      // A task after rAF leaves paint first. A nested timer costs 4 ms of the next build's frame before any work starts.
      frame = scope.raf(() => {
        if (done) return;
        frame = undefined;
        if (typeof globalThis.MessageChannel !== 'function') { task = scope.timeout(0, () => { task = undefined; check(); }); return; }
        const channel = new MessageChannel(), active = scope.child('frame-turn'); turn = active;
        active.onDispose(() => { channel.port1.close(); channel.port2.close(); });
        active.listen(channel.port1, 'message', () => { active.dispose(); turn = undefined; scope.run(check); }, { once: true });
        channel.port1.start(); channel.port2.postMessage(0);
      });
    };
    // A hidden or suspended presentation can stop rAF entirely. The existing
    // cap must have its own task, rather than waiting for another frame to check it.
    if (!done) cap = scope.timeout(WAIT_CAP_MS, finish);
    check();
  });
}

/**
 * End a build stretch: when presenting and a frame is due, wait for the loop to draw it; otherwise `plain()` (the caller's
 * own macrotask hop: a timer, a MessageChannel). `budgetMs`: also wait once the builds since the last drawn frame have used
 * that much of it (`frameBudgetSpent`), so concurrent sliced builds share one frame's budget. Queued live tasks recheck
 * this fence on delivery, before admitting their awaiting continuation.
 */
export function paceYield(plain: () => Promise<void>, owner?: Scope, budgetMs?: number): Promise<void> {
  const now = diagnosticNow();
  if (yieldDue(budgetMs, now)) return nextDrawnFrame(owner);
  const turn = plain();
  // Other builders can spend the frame while this task is queued. A message/timer hop alone must not admit its
  // awaiting continuation on the stale pre-hop budget. Loading and Node keep the original promise/turn unchanged.
  return presenting(now) ? turn.then(() => owner?.disposed !== true && yieldDue(budgetMs, diagnosticNow()) ? nextDrawnFrame(owner) : undefined) : turn;
}

function yieldDue(budgetMs: number | undefined, now: number): boolean {
  return !held && (!urgent || budgetMs === undefined) && frameDue(now) || (budgetMs !== undefined && frameBudgetSpent(budgetMs, now));
}
