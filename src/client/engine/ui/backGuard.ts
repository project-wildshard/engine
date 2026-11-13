/**
 * The back guard: in play, the browser's back (iOS Safari's left-edge swipe, Android's back gesture, the back button)
 * stays in the world instead of leaving it (Jake, 2026-11-13: "iOS swipe, edge swipe, back gesture, whatever it is,
 * disable that"; QA-FEEDBACK-2026-11-13 row 20).
 *
 * Arming pushes one same-URL history entry marked as the guard. A back lands on the entry under it, in this same
 * document (a `popstate`, no page load), and the guard pushes itself again: the player stays where they stood.
 * Only play arms it; the title and menus are other documents, so their back is the browser's own.
 *
 * The game's own ways out (Exit, a shard switch, a reload) go through `leaveSaved`, which first releases the guard:
 * it steps back off the guard entry, so the `location.replace` that follows replaces the play entry itself and no
 * stale play page is left behind the title.
 */

import { pageScope } from '../../../shared/engine/app/resources';
import { beforeLeaving } from '../boot/lastEnd';

const MARK = 'wsBackGuard';

export interface BackGuardPorts {
  readonly history: Pick<History, 'pushState' | 'replaceState' | 'back'> & { readonly state: unknown };
  readonly url: () => string;
  listen: (handler: () => void) => () => void;
  /** a fallback for a browser that never answers the release's back */
  later: (go: () => void, ms: number) => void;
}

export interface BackGuard {
  /** Whether the guard holds the history now. */
  readonly armed: boolean;
  /** How many backs it has turned away. */
  readonly turned: number;
  /** Step off the guard entry and stop guarding; resolves once the history is back on the play entry. */
  release: () => Promise<void>;
}

const guardState = (state: unknown): boolean => typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MARK] === true;
const withMark = (state: unknown): Record<string, unknown> => ({ ...(typeof state === 'object' && state !== null ? state : {}), [MARK]: true });
const withoutMark = (state: unknown): unknown => {
  if (!guardState(state)) return state;
  const { [MARK]: _mark, ...rest } = state as Record<string, unknown>;
  return rest;
};
/** How long a release waits for its back's popstate before the game leaves anyway (a busy phone answers late). */
const RELEASE_WAIT_MS = 1500;

export function armBackGuard(ports: BackGuardPorts): BackGuard {
  let armed = true, turned = 0, releasing: (() => void) | null = null;
  // A reload (or iOS reviving an evicted tab) keeps history.state, so this page may start on an old guard entry:
  // make it this page's play entry again, so a release steps back onto an entry the replace can take.
  const base = withoutMark(ports.history.state);
  if (guardState(ports.history.state)) ports.history.replaceState(base, '', ports.url());
  ports.history.pushState(withMark(base), '', ports.url());
  const stop = ports.listen(() => {
    if (releasing !== null) { const done = releasing; releasing = null; done(); return; }
    // Any traverse while armed is a back off our entry (forward entries are cleared by each push). The entry under it
    // may itself be marked: a reload keeps history.state, so check nothing but that we are armed.
    if (!armed) return;
    turned++;
    ports.history.pushState(withMark(ports.history.state), '', ports.url());
  });
  return {
    get armed() { return armed; },
    get turned() { return turned; },
    release: () => new Promise<void>((resolve) => {
      if (!armed) { resolve(); return; }
      armed = false;
      const finish = (): void => { stop(); resolve(); };
      if (!guardState(ports.history.state)) { finish(); return; }
      let settled = false;
      const once = (): void => { if (!settled) { settled = true; finish(); } };
      releasing = once;
      ports.history.back();
      ports.later(once, RELEASE_WAIT_MS);
    }),
  };
}

const browserPorts = (): BackGuardPorts => ({
  history,
  url: () => location.href,
  listen: (handler) => pageScope.listen(window, 'popstate', handler),
  later: (go, ms) => { pageScope.timeout(ms, go); },
});

let current: BackGuard | null = null;

/** Arm the guard for this page's play (idempotent). */
export function guardPlayBack(ports: BackGuardPorts = browserPorts()): BackGuard {
  if (current?.armed === true) return current;
  current = armBackGuard(ports);
  beforeLeaving(releasePlayBack);
  return current;
}

/** Release the page's guard before the game leaves on its own; resolves at once when none is armed. */
export function releasePlayBack(): Promise<void> {
  const guard = current;
  current = null;
  return guard === null ? Promise.resolve() : guard.release();
}

/** Whether play holds the back now (for a proof or the debug overlay). */
export function playBackGuarded(): boolean { return current?.armed === true; }
