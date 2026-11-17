// FM8s (meta docs/plans/MMO-FAILURE-MODES-PLAN.md, modes 30, 30b and 31): what a player sees when the server's own saves are late or
// failing. The facts are the server's per-player `save-confirmed` / `save-failed` words (FM7b3, `persistenceWord.ts`), heard on this
// page's link; nothing here guesses one. J229: a last-save time is only ever the moment this page heard a confirmed save, and is left
// out when there was none. An older server or a memory store sends no fact, so this says nothing at all (never a late save).
//
//   notice  `save-slow`         Saving · retrying (a save failed, the server tries again) or Saving · last saved 14:02 (no confirmed
//                               save for longer than the server's checkpoint, SAVE_CHECKPOINT_MS, plus a margin)
//   card    `save-failed`       Progress isn't saving: saves kept failing for SAVE_FAILED_MS. Keep playing leaves a lasting notice
//   hold    `save-slow-blocked` the player's own Leave the world while either shows: Leave when saved, Leave now, Keep playing
//
// Leave the world is asked through a cancelable `ws:leave-world` event (HUD.exitToMenu), so this bundle (online.js is its own) holds it
// without sharing a module with the page. Reloads are never held: they keep R3/R4's existing bounds.
import type { Scope } from '@wildshard/engine/app/scope';
import { SAVE_CHECKPOINT_MS, type PersistenceWord } from '@wildshard/engine/net/persistenceWord';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { showFailure, clearFailure } from '@wildshard/engine/telemetry/runtime';
import { buttons, card, linkStyle, make, ring } from './linkScreens';

/** No confirmed save for this long is late: the server checkpoints each seated player at least every SAVE_CHECKPOINT_MS. */
export const SAVE_LATE_MS: number = SAVE_CHECKPOINT_MS + 15_000;
/** Saves failing for this long (the server retries each second) open the card. */
export const SAVE_FAILED_MS = 10_000;

const CSS = `
.ws-save-chip{top:calc(44px + env(safe-area-inset-top,0px))}
.ws-save-chip::before{content:''!important;width:7px;height:7px;background:var(--t);box-shadow:0 0 8px var(--t)}
.ws-save-chip .ring{width:10px;height:10px;color:var(--t)}
`;

/** What the page tells the save screens. */
export interface SaveScreens {
  /** A persistence fact heard on the link (`OnlineView.persistence`). */
  readonly fact: (fact: PersistenceWord) => void;
  /** Is the link carrying frames? While it isn't, the link's own screens speak and no save fact can come. */
  readonly link: (live: boolean) => void;
}
type Trouble = 'late' | 'retrying' | 'failed' | null;

const clock = (wall: number): string => new Date(wall).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** How long without a confirmed save, in the card's words. */
const quiet = (ms: number): string => ms < 90_000 ? `${String(Math.floor(ms / 1000))} s` : `${String(Math.floor(ms / 60_000))} min`;
const exactClock = (wall: number): string => new Date(wall).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/**
 * FM8s: the save screens. Returns what the shell calls.
 *
 *   const saves = saveScreens(scope);
 *   connectOnline(config, { …, persistence: saves.fact, link: state => { saves.link(state === 'live'); } });
 */
export function saveScreens(scope: Scope, parent: HTMLElement = document.body): SaveScreens {
  linkStyle();
  if (document.getElementById('ws-save-style') === null) { const style = make('style'); style.id = 'ws-save-style'; style.textContent = CSS; document.head.append(style); }

  let heard = false, live = true, since = diagnosticNow(), confirmedWall: number | null = null, dismissed = false;
  /** Each save scope (shard) still failing: since when, its newest failed sequence and how many failures were heard. */
  const failing = new Map<string, { since: number; sequence: number; count: number }>();
  const trouble = (now: number): Trouble => {
    if (!heard || !live) return null;
    let first = Infinity;
    for (const row of failing.values()) first = Math.min(first, row.since);
    if (first !== Infinity) return now - first >= SAVE_FAILED_MS ? 'failed' : 'retrying';
    return now - since >= SAVE_LATE_MS ? 'late' : null;
  };
  const failures = (): number => [...failing.values()].reduce((sum, row) => sum + row.count, 0);
  const lost = (): string => confirmedWall === null ? 'anything since the last confirmed save' : `anything after ${clock(confirmedWall)}`;

  // the notice: Saving (late or retrying), or Not saving once the card was put away
  let chip: { scope: Scope; root: HTMLElement; line: HTMLElement; ids: string } | null = null;
  const unchip = (cause: 'recovered' | 'replaced' | 'dismissed' = 'recovered'): void => { if (chip !== null) { clearFailure(chip.root, cause); chip.scope.dispose(); } chip = null; };
  const showChip = (ids: 'save-slow' | 'save-failed', title: string, line: string): void => {
    if (chip?.ids !== ids) {
      unchip('replaced');
      const own = scope.child('online.save-chip'), root = own.ownNode(make('div', 'ws-link ws-link-notice ws-save-chip')), text = make('span');
      root.dataset['failmode'] = ids; root.dataset['tone'] = ids === 'save-failed' ? 'bad' : 'warn'; root.setAttribute('role', 'status');
      root.append(make('b', '', title), text);
      parent.append(root);
      showFailure(own, root, ids);
      chip = { scope: own, root, line: text, ids };
    }
    chip.line.replaceChildren(...line === 'retrying' ? [ring(), ' retrying'] : [line]);
  };

  // the cards: the failed card, or the hold card on a Leave
  let open: { scope: Scope; root: HTMLElement; kind: 'failed' | 'hold'; paint: () => void } | null = null;
  let waiting: (() => void) | null = null;
  const close = (cause: 'recovered' | 'replaced' | 'dismissed' = 'dismissed'): void => { if (open !== null) { clearFailure(open.root, cause); open.scope.dispose(); } open = null; };
  const freePointer = (): void => { if ('exitPointerLock' in document && document.pointerLockElement instanceof Element) document.exitPointerLock(); };
  const failedCard = (): void => {
    close('replaced');
    const own = scope.child('online.save-failed'), { root, box } = card(own, 'save-failed', 'bad', 'Saves', 'Progress isn\'t saving');
    const body = make('p', 'ws-link-body'), status = make('ul', 'ws-link-facts'), tries = make('li');
    status.setAttribute('role', 'status'); status.append(tries);
    const paint = (): void => {
      body.textContent = `The server can't save right now and keeps trying. You can keep playing, but ${lost()} may be lost if you leave.`;
      const count = failures();
      tries.replaceChildren(ring(), `Save failed ${String(count)} ${count === 1 ? 'time' : 'times'}`);
    };
    paint();
    box.append(body, status, buttons(own, [
      { label: 'Keep playing', primary: true, act: () => { dismissed = true; close(); showChip('save-failed', 'Not saving', 'retrying'); } },
      // the page's own Leave the world, which the hold card then warns about (it stays possible)
      { label: 'Leave the world', act: () => { document.dispatchEvent(new CustomEvent('ws:exit-to-main')); } },
    ]));
    parent.append(root); freePointer();
    open = { scope: own, root, kind: 'failed', paint };
    root.querySelector('button')?.focus();
  };
  const holdCard = (go: () => void): void => {
    close('replaced');
    const failingNow = failing.size > 0, own = scope.child('online.save-hold');
    const { root, box } = card(own, 'save-slow-blocked', failingNow ? 'bad' : 'warn', 'Saving', 'Saving your last moves');
    const want = make('p', 'ws-link-want');
    want.append('You tapped ', make('b', '', 'Leave the world'), make('i', '', 'on hold'));
    const body = make('p', 'ws-link-body'), facts = make('ul', 'ws-link-facts'), last = make('li'), state = make('li');
    facts.setAttribute('role', 'status'); facts.append(last, state);
    const paint = (): void => {
      const now = diagnosticNow(), count = failures();
      body.textContent = `${count > 0 ? 'The server couldn\'t save your latest progress and is trying again.' : 'The server hasn\'t confirmed a save for a while.'} Leave now and ${lost()} may be lost; wait and you leave once it saves.`;
      last.textContent = confirmedWall === null ? 'No save confirmed yet' : `Last saved ${exactClock(confirmedWall)}`;
      state.replaceChildren(ring(), count > 0 ? `Save failed ${String(count)} ${count === 1 ? 'time' : 'times'}` : `No save for ${quiet(now - since)}`);
    };
    paint();
    box.prepend(want);
    box.append(body, facts, make('p', 'ws-link-auto', 'With Leave when saved, you leave by yourself as soon as the server confirms a save.'), buttons(own, [
      { label: 'Leave when saved', primary: true, busy: 'Waiting for the save…', act: () => { waiting = go; } },
      { label: 'Leave now', act: () => { waiting = null; close(); go(); } },
      { label: 'Keep playing', act: () => { waiting = null; close(); } },
    ]));
    parent.append(root); freePointer();
    open = { scope: own, root, kind: 'hold', paint };
    root.querySelector('button')?.focus();
  };

  /** Once a second, and on every fact: the screen the facts call for. */
  const sample = (): void => {
    const now = diagnosticNow(), said = trouble(now);
    if (said === null) {
      unchip(); dismissed = false;
      // a hold card on a link that dropped gives way to the link's screens; its wait goes with it
      if (open !== null) { waiting = null; close(live ? 'recovered' : 'replaced'); }
      return;
    }
    if (said === 'failed' && !dismissed && open === null) failedCard();
    open?.paint();
    if (said === 'failed' && dismissed) showChip('save-failed', 'Not saving', 'retrying');
    else if (said === 'failed' && open?.kind === 'failed') unchip('replaced');
    else if (said === 'late') showChip('save-slow', 'Saving', confirmedWall === null ? 'no save confirmed yet' : `last saved ${clock(confirmedWall)}`);
    else showChip('save-slow', 'Saving', 'retrying');
  };
  scope.interval(1000, sample);
  scope.listen(document, 'ws:leave-world', event => {
    if (trouble(diagnosticNow()) === null || !(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (typeof detail !== 'object' || detail === null || !('go' in detail) || typeof detail.go !== 'function') return;
    const go = detail.go as () => void;
    event.preventDefault();
    holdCard(go);
  });
  scope.onDispose(() => { waiting = null; close('replaced'); unchip('replaced'); });

  return {
    fact: fact => {
      const now = diagnosticNow();
      const row = failing.get(fact.scope);
      heard = true;
      if (fact.code === 'save-confirmed') {
        // an older save's confirmation clears no newer failure
        if (row === undefined || fact.sequence >= row.sequence) failing.delete(fact.scope);
        confirmedWall = Date.now(); since = now;
        if (failing.size === 0 && waiting !== null) { const go = waiting; waiting = null; close('recovered'); go(); return; }
      } else {
        failing.set(fact.scope, { since: row?.since ?? now, sequence: Math.max(row?.sequence ?? 0, fact.sequence), count: (row?.count ?? 0) + 1 });
      }
      sample();
    },
    link: next => {
      if (next && !live) since = diagnosticNow();
      live = next;
      sample();
    },
  };
}
