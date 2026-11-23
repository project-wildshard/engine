// FM4 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md, 9b `restart-blocked` and 10b `deploy-blocked`): Enter world on the title while the
// world is restarting or about to move. The title has no link, so it asks the world's first word on a socket of its own (`askWorld`,
// before any hello: no seat). Only what the page observed: a world that isn't answering after a restart this tab heard (the in-world
// `restart` close, noted by the shell and cleared on the next seat), or the world's own word that a move is due in the last 15 s
// (`moving`, J174). Then the tap holds on a card that joins by itself when the world is back; Cancel stays on the title. Anything else
// enters at once and the in-world screens say why, with no guessed cause.
import { Scope } from '@wildshard/engine/app/scope';
import { restartRecent } from '@wildshard/engine/game/grid/worldRestart';
import { buttons, card, linkStyle, make, ring } from './linkScreens';

/** What a title's own socket heard: the world's first word (and a move due in so many seconds), or nothing in time. */
export type WorldHeard = { readonly heard: false } | { readonly heard: true; readonly movingInS: number | null };
export interface TitleWorld { readonly release: string; readonly key: string }

/** In a deploy's last this-many seconds, Enter world waits for the move (the plan's 10b). */
const DEPLOY_HOLD_S = 15;
/** How often a held entry asks the world again: each ask is a socket, and the door takes 10 a minute from one address. */
const AGAIN_MS = 8000;
type Hold = 'restart' | 'deploy' | null;
const holdFor = (heard: WorldHeard, now: number): Hold => heard.heard
  ? heard.movingInS !== null && heard.movingInS <= DEPLOY_HOLD_S ? 'deploy' : null
  : restartRecent(now) ? 'restart' : null;

/**
 * Enter world from the title: `go` now, or once the world is back. Resolves when it entered or the player cancelled.
 *
 *   gate: go => { void holdTitleEntry(world, go); }
 */
let held = false;
export async function holdTitleEntry(world: TitleWorld, go: () => void, ask: (world: TitleWorld) => Promise<WorldHeard>, parent: HTMLElement = document.body): Promise<void> {
  // a second tap while the first is asked or held does nothing
  if (held) return;
  held = true;
  try { await holdOnce(world, go, ask, parent); } finally { held = false; }
}
async function holdOnce(world: TitleWorld, go: () => void, ask: (world: TitleWorld) => Promise<WorldHeard>, parent: HTMLElement): Promise<void> {
  const first = await ask(world);
  let hold = holdFor(first, Date.now());
  if (hold === null) { go(); return; }
  linkStyle();
  const scope = new Scope('online.title-hold');
  let movingUntil = first.heard && first.movingInS !== null ? Date.now() + first.movingInS * 1000 : 0;
  return new Promise<void>(resolve => {
    let asks = 1, lastAsk = Date.now(), asking = false;
    const end = (enter: boolean): void => { if (scope.disposed) return; scope.dispose(); if (enter) go(); resolve(); };
    let paint = (): void => undefined, shown: Scope | null = null;
    const draw = (): void => {
      shown?.dispose();
      const own = scope.child('online.title-hold.card'), restart = hold === 'restart';
      shown = own;
      const { root, box } = card(own, restart ? 'restart-blocked' : 'deploy-blocked', 'info', restart ? 'Restarting' : 'World update', restart ? 'The world is restarting' : 'The world is updating');
      const want = make('p', 'ws-link-want');
      want.append('You tapped ', make('b', '', 'Enter world'), make('i', '', 'on hold'));
      const body = make('p', 'ws-link-body', restart ? 'The world is restarting and isn\'t answering yet. You\'ll join by yourself as soon as it\'s back.'
        : 'The world is moving to a new version. You\'ll join by yourself once it has.');
      const facts = make('ul', 'ws-link-facts'), line = make('li');
      facts.setAttribute('role', 'status'); facts.append(line);
      paint = (): void => {
        const left = Math.ceil((movingUntil - Date.now()) / 1000);
        line.replaceChildren(ring(), hold === 'deploy' && left > 0 ? `Update in ${String(left)} s` : `Asked ${String(asks)} ${asks === 1 ? 'time' : 'times'} · next in ${String(Math.max(1, Math.ceil((lastAsk + AGAIN_MS - Date.now()) / 1000)))} s`);
      };
      paint();
      box.prepend(want);
      box.append(body, facts, make('p', 'ws-link-auto', 'This joins by itself when the world is back. Cancel stays on the title.'),
        buttons(own, [{ label: 'Cancel', act: () => { end(false); } }]));
      parent.append(root);
      root.querySelector('button')?.focus();
    };
    draw();
    scope.interval(1000, () => {
      const now = Date.now();
      // the world's own countdown: no ask before the move is due
      if (hold === 'deploy' && now < movingUntil) { paint(); return; }
      if (asking || now - lastAsk < AGAIN_MS) { paint(); return; }
      asking = true; lastAsk = now; asks++;
      void ask(world).then(heard => {
        asking = false;
        if (scope.disposed) return undefined;
        if (heard.heard && (heard.movingInS === null || heard.movingInS > DEPLOY_HOLD_S)) { end(true); return undefined; }
        // a move announced while held: the card says so; a deploy's move is a restart, so silence then keeps waiting
        if (heard.heard && heard.movingInS !== null && hold !== 'deploy') { hold = 'deploy'; movingUntil = Date.now() + heard.movingInS * 1000; draw(); }
        paint();
        return undefined;
      }, () => { asking = false; });
    });
  });
}
