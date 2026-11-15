// FM5 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): what a player sees while the page has no release file to dial from. Modes 1, 11, 12,
// 37, 38 and 39 are **pages** (the plan's first style): before the world, over the loading card, the whole screen, one button that does
// something, and they move on by themselves when the file answers. Mode 46 is the staging **mark**: a quiet line for the session.
// The waits are release.ts's policy (`releaseRetryMs`); this file only says so and counts down the real scheduled read.
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { captureBrowserError } from '@wildshard/engine/telemetry/browserErrors';
import { buttons, card, linkStyle, make, ring } from './linkScreens';
import { releaseScreen, type ReleaseFault, type ReleaseScreen, type ReleaseWait } from './release';

/** The words of each page: a tag, a headline and the key line. No status code, address or exception is primary copy (Details holds them). */
const WORDS: Readonly<Record<ReleaseScreen, { readonly tag: string; readonly title: string; readonly body: string; readonly tone: 'warn' | 'bad' | 'info' }>> = {
  'offline-launch': { tag: 'Offline', title: 'You\'re offline', body: 'We\'ll connect as soon as you\'re back.', tone: 'warn' },
  'release-5xx': { tag: 'Can\'t find the world', title: 'Can\'t find the world', body: 'The world\'s information didn\'t arrive. We\'ll try again by ourselves.', tone: 'warn' },
  'release-429': { tag: 'Busy', title: 'Lots of players joining', body: 'You don\'t need to do anything: we\'ll try again when the world says to.', tone: 'info' },
  'release-404': { tag: 'Not available', title: 'World information isn\'t available', body: 'Check your connection, or try again later. We\'ll look again every minute.', tone: 'warn' },
  'captive-portal': { tag: 'Network sign-in', title: 'This network may need sign-in', body: 'Something other than the world answered. If this network has a sign-in page, sign in, then try again.', tone: 'warn' },
  'release-unsigned': { tag: 'Not verified', title: 'Couldn\'t check the world', body: 'We won\'t connect to a world we can\'t verify.', tone: 'bad' },
};

/** Details: what was measured, never a guess (a browser can't tell DNS from TLS from a reset). */
function measured(fault: ReleaseFault): string {
  if (fault.kind === 'offline') return 'The browser says this device is offline.';
  if (fault.kind === 'network') return 'No HTTP response. Check the connection.';
  if (fault.kind === 'timeout') return `No answer in ${String(Math.round(fault.ms / 1000))} s.`;
  if (fault.kind === 'status') return `HTTP ${String(fault.status)}${fault.retryAfterMs === null ? '' : `, Retry-After ${String(Math.round(fault.retryAfterMs / 1000))} s`}.`;
  if (fault.kind === 'unsigned') return 'The world\'s file failed its signature check.';
  return fault.why === 'redirect' ? 'The read was sent to another address.' : fault.why === 'html' ? 'A web page answered instead of the world\'s file.' : 'The answer was not a signed world file.';
}

export interface ReleaseScreenHooks {
  /** Open the Connection doctor (E7.5), naming the screen that asked. */
  readonly doctor?: (from: string) => void;
  /** Leave for the title screen. */
  readonly title: () => void;
  /** Where mode 39 reports (the browser error tracker; a test observes its own). */
  readonly report?: typeof captureBrowserError;
}

/**
 * FM5: the release pages, as release.ts's `ReleaseWait`. Each failed read shows its page and settles when the page should read again:
 * the policy's scheduled time (counted down on the page), Try again, the network coming back, or (a portal) the page coming into view.
 * Title screen rejects, so the load stops and the player leaves. `done` closes the page.
 *
 *   await releaseToDial(url, key, { keep, wait: releaseScreens(scope, { doctor, title }) });
 */
export function releaseScreens(scope: Scope, hooks: ReleaseScreenHooks, parent: HTMLElement = document.body): ReleaseWait {
  const report = hooks.report ?? captureBrowserError;
  let shown: Scope | null = null, reported = false;
  const close = (): void => { shown?.dispose(); shown = null; };
  scope.onDispose(close);
  return {
    done: close,
    after: (fault, attempt, retryMs, detail) => new Promise<void>((resolve, reject) => {
      close();
      linkStyle();
      const id = releaseScreen(fault), words = WORDS[id], page = new Scope(`online.release-${id}`, scope);
      shown = page;
      const { root, box } = card(page, id, words.tone, words.tag, words.title);
      root.classList.add('ws-link-page');
      box.append(make('p', 'ws-link-body', words.body));
      let settled = false;
      const go = (): void => { if (settled) return; settled = true; resolve(); };
      const leave = (): void => { if (settled) return; settled = true; reject(new Error('The player left the release wait for the title')); hooks.title(); };
      page.onDispose(() => { if (!settled) { settled = true; resolve(); } });
      // the next read, counted from what is actually scheduled: never a made-up clock
      const status = make('p', 'ws-link-auto');
      if (retryMs !== null) {
        const due = diagnosticNow() + retryMs, line = make('span');
        const tick = (): void => { const left = Math.max(0, Math.ceil((due - diagnosticNow()) / 1000)); line.textContent = `Next try in ${String(left)} s · ${attempt === 0 ? 'first try failed' : `${String(attempt + 1)} tries so far`}`; };
        tick(); page.interval(500, tick); page.timeout(retryMs, go);
        status.append(ring(), line);
        box.append(status);
      } else if (id === 'offline-launch') {
        status.append(ring(), make('span', '', 'Waiting for the network'));
        box.append(status);
      }
      // the network back, or a portal's page back in view after a sign-in elsewhere: read again now
      page.listen(window, 'online', go);
      if (id === 'captive-portal') page.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
      const actions: { label: string; primary?: true; busy?: string; act: () => void }[] = [];
      // mode 12 waits what the world asked; a tap doesn't jump that queue
      if (id !== 'release-429') actions.push({ label: retryMs === null ? 'Try again' : 'Try now', primary: true, busy: 'Trying…', act: go });
      if (hooks.doctor !== undefined && id !== 'offline-launch') { const { doctor } = hooks; actions.push({ label: 'Check connection', act: () => { doctor(id); } }); }
      actions.push({ label: 'Title screen', act: leave });
      box.append(buttons(page, actions));
      const details = make('details'), summary = make('summary', '', 'Details');
      details.append(summary, make('p', '', `${measured(fault)} ${detail}`));
      box.append(details);
      parent.append(root);
      root.querySelector<HTMLButtonElement>('button')?.focus(); // the first action takes focus; card() keeps Tab inside
      // mode 39 goes to the error report queue, once a page
      if (id === 'release-unsigned' && !reported) { reported = true; try { report(new Error(`Release file failed its signature: ${detail}`), { system: 'link', build: '', shard: '', bootStage: 'loading', fatal: false, screen: 'release-unsigned', diagnostic: { detail } }); } catch { /* telemetry never stops the page */ } }
    }),
  };
}

/** FM5 mode 46: a page on the staging world says so, for the whole session. Returns its node (owned by `scope`). */
export function stagingMark(scope: Scope, parent: HTMLElement = document.body): HTMLElement {
  linkStyle();
  const mark = scope.ownNode(make('div', 'ws-link ws-link-mark', 'Staging · not the live world'));
  mark.dataset['failmode'] = 'staging'; mark.dataset['tone'] = 'warn'; mark.setAttribute('role', 'status');
  parent.append(mark);
  return mark;
}
