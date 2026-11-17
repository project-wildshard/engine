// FM5b2 and FM5b3 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md, mode 24; J219, J229): the page's own code was retired (FM5b1's
// `retentionWatch`). While playing, a banner (`too-old-warning`) says so, with a countdown only from a signed deadline; at zero it says
// update at the next load and still never navigates: a fight is never interrupted. The next zone entry, reconnect or boot is refused
// with the `too-old` page instead. Update, from either, is the player's own reload (R3/R4, `playerReload.ts`), once.
import type { Scope } from '@wildshard/engine/app/scope';
import { showFailure, clearFailure } from '@wildshard/engine/telemetry/runtime';
import { buttons, card, linkStyle, make } from './linkScreens';
import type { RetentionView } from './retentionWatch';

const CSS = `
.ws-too-old{pointer-events:auto}
.ws-too-old button{width:auto;min-height:32px;padding:7px 12px;font-size:10px;letter-spacing:.18em}
`;

export interface TooOldScreens {
  /** FM5b1's view changed. */
  readonly retention: (view: RetentionView) => void;
  /** Is the link carrying frames? While it isn't, the link's own banner has the top band. */
  readonly link: (live: boolean) => void;
  /** Before a zone entry, a reconnect or the first seat: true when this retired build refuses it (the page is up). */
  readonly refuse: (what: 'zone' | 'reconnect' | 'boot') => boolean;
}
export interface TooOldHooks {
  /** The player's own reload into the current build (R3/R4: the cover paints in the tap's turn). */
  readonly update: () => void;
}

const left = (ms: number): string => ms < 90_000 ? `${String(Math.ceil(ms / 1000))} s` : `${String(Math.floor(ms / 60_000))} min`;

export function tooOldScreens(scope: Scope, hooks: TooOldHooks, parent: HTMLElement = document.body): TooOldScreens {
  linkStyle();
  if (document.getElementById('ws-too-old-style') === null) { const style = make('style'); style.id = 'ws-too-old-style'; style.textContent = CSS; document.head.append(style); }
  let view: RetentionView = { availability: 'unknown', retireAt: null }, live = true, updating = false;
  const update = (): void => { if (updating) return; updating = true; hooks.update(); };

  const banner = scope.ownNode(make('div', 'ws-link ws-link-banner ws-too-old')), line = make('span');
  banner.dataset['failmode'] = 'too-old-warning'; banner.dataset['tone'] = 'warn'; banner.setAttribute('role', 'status'); banner.hidden = true;
  banner.append(make('b', '', 'Update needed'), line, buttons(scope, [{ label: 'Update', busy: 'Updating', act: update }]));
  parent.append(banner);

  let page: { scope: Scope; root: HTMLElement } | null = null;
  const paint = (): void => {
    const shown = view.availability === 'retired' && live && page === null;
    banner.hidden = !shown;
    if (!shown) { clearFailure(banner, view.availability === 'retired' ? 'replaced' : 'recovered'); return; }
    showFailure(scope, banner, 'too-old-warning');
    // a signed deadline counts down; none, or past it, is the next load (J229: never a made-up countdown, never a navigation)
    const ms = view.retireAt === null ? 0 : view.retireAt - Date.now();
    line.textContent = ms > 0 ? `this version retires in ${left(ms)}` : 'at the next load';
  };
  scope.interval(1000, paint);

  const showPage = (): void => {
    if (page !== null) return;
    const own = scope.child('online.too-old'), { root, box } = card(own, 'too-old', 'bad', 'Update required', 'Your game is too old');
    root.classList.add('ws-link-page');
    box.append(make('p', 'ws-link-body', 'This copy of Project Wildshard is no longer kept, so it can\'t join the world. Update to keep playing. Your progress is safe on the server.'),
      buttons(own, [{ label: 'Update now', primary: true, busy: 'Updating', act: update }]),
      make('p', 'ws-link-auto', 'Still seeing this after updating? If you added the game to your home screen, close it fully from the app switcher and open it again.'));
    parent.append(root);
    page = { scope: own, root };
    paint();
    root.querySelector('button')?.focus();
  };
  scope.onDispose(() => { if (page !== null) { clearFailure(page.root, 'replaced'); page.scope.dispose(); page = null; } clearFailure(banner, 'replaced'); });

  return {
    retention: next => {
      view = next;
      // a verified keep lifts the page too: the next entry goes ahead
      if (view.availability !== 'retired' && page !== null) { clearFailure(page.root, 'recovered'); page.scope.dispose(); page = null; }
      paint();
    },
    link: next => { live = next; paint(); },
    refuse: () => {
      if (view.availability !== 'retired') return false;
      showPage();
      return true;
    },
  };
}
