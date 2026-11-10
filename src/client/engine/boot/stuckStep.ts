/**
 * DL21: a boot that stops moving gets a named way out instead of a silent dead card. The composition root
 * (src/client/app/entry.ts `start`) watches its selected-shard start with `watchStuckStep`: the loading card's progress (its step,
 * setup share and bytes read, `progressOfCard`) is read every second, and once none of it has moved for `boundMs` the
 * watch calls `stalled` once with the step it is stuck on (the root opens the fatal modal, whose RELOAD HERE is the retry
 * under the shared reload budget, src/client/engine/core/reloadGuard.ts). A settled start, either way, ends the watch; a start
 * that throws names the step it died on (`stuckMessage`). A boot that waits on the player (the card's PLAY is up: Developer
 * ▸ Hold at loading screen, src/client/engine/ui/Loading.ts `waitForPlay`) is not stuck: no time counts while it waits, and
 * the bound starts over when loading goes on (Jake, 2026-11-10: "When the play button is ready, you don't need this error state").
 */
import { diagnosticNow } from '../../../shared/engine/core/clock';

/** How long the card may show no progress at all before the boot is called stuck: a phone-link step still moves its
 *  bytes counter well inside this, so only a hang trips it. */
export const STUCK_STEP_MS = 60_000;

/** What the watch reads each second: the step, a signature of its progress, and whether the boot waits on the player
 *  (`player`: PLAY is up, so the next move is theirs and no stall can be the boot's). */
export interface StuckProgress { readonly step: string; readonly signature: string; readonly player?: boolean }

/** The watch's ports: the card's progress, a clock (default the diagnostic clock), a repeating timer and the stall's
 *  handler. */
export interface StuckStepPorts {
  readonly progress: () => StuckProgress;
  readonly now?: () => number;
  readonly every: (ms: number, run: () => void) => () => void;
  readonly stalled: (step: string, stuckMs: number) => void;
}

/** Watch `started` until it settles; calls `stalled` at most once. Returns the stop. */
export function watchStuckStep(started: Promise<unknown>, ports: StuckStepPorts, boundMs: number = STUCK_STEP_MS): () => void {
  const now = ports.now ?? diagnosticNow;
  let last = ports.progress().signature, since = now(), live = true;
  const tick = (): void => {
    if (!live) return;
    const { step, signature, player = false } = ports.progress(), at = now();
    // a wait on the player holds the bound at zero; whatever follows it gets the whole bound again
    if (player || signature !== last) { last = signature; since = at; return; }
    if (at - since < boundMs) return;
    stop();
    ports.stalled(step, at - since);
  };
  const cancel = ports.every(1000, tick);
  function stop(): void { if (live) { live = false; cancel(); } }
  void started.then(stop, stop);
  return stop;
}

/** What of the loading card the watch reads (an element's `dataset`). */
export interface StuckCard { readonly dataset: Readonly<Record<string, string | undefined>> }
/** The loading card's progress: its step (`data-step`), and a signature that changes whenever the step, the setup share,
 *  the verified bytes read, the files done or the bytes streamed (`data-streamed-bytes`: a part's chunks as they arrive,
 *  before its members verify, src/client/game/boot/spawnDownload.ts) do, and each beat of a wait for a seat in a full world
 *  (`data-seat-wait`, J178: that wait is the world's, and no hang). A card whose PLAY is up (`data-ready`, set only while
 *  Loading waits for PLAY) waits on the player. No card: the boot is still in its modules. */
export function progressOfCard(card: StuckCard | null): StuckProgress {
  if (card === null) return { step: 'modules', signature: 'modules' };
  const data = card.dataset, step = data['step'] ?? 'modules';
  return { step, signature: [step, data['setup'] ?? '', data['readBytes'] ?? '', data['spawnFilesDone'] ?? '', data['streamedBytes'] ?? '', data['seatWait'] ?? ''].join('|'),
    player: data['ready'] === 'true' };
}

/** The fatal modal's line for a stuck or failed boot: the step it stopped on, then what happened. */
export function stuckMessage(step: string, what: { readonly stuckMs: number } | { readonly error: unknown }): string {
  if ('stuckMs' in what) return `The game stopped loading at step "${step}" (no progress for ${Math.round(what.stuckMs / 1000)} s)`;
  const error = what.error;
  return `The game failed to start at step "${step}" (${error instanceof Error ? `${error.name}: ${error.message}` : String(error)})`;
}
