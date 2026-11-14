// FM4 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): what a player sees while the world's link is down, and what a tap gets meanwhile.
// Jake, 2026-11-10: "It can't be silently broken", and "every banner screen needs a sibling/sister screen that's like 'the modal you
// see if you try to play because you can't play'". Three of the plan's five styles live here: the **banner** (a tab in the top band,
// play goes on), the **notice** (Reconnected), the **card** (the link gave up, the world is full, another tab took the seat, the server
// turned the link away) and its **hold card** (the banner's sibling: what was tapped, the dial's live progress, what happens by itself).
// The look is the Developer prototypes' (src/client/app/failScreens.ts, FM1b); each root carries the catalogue's `data-failmode` ids.
import type { Scope } from '@wildshard/engine/app/scope';
import type { LinkCause, LinkProgress, LinkState } from '@wildshard/engine/net/redial';
import type { Countdown } from '@wildshard/engine/net/socketFrames';
import type { TransportStats } from '@wildshard/engine/net/transport';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { captureBrowserError } from '@wildshard/engine/telemetry/browserErrors';

declare const __BUILD_ID__: string;
/** SENTRY-TRIAGE S13: a stop card that means the link failed (`link-lost`, `link-refused`) sends one event as it opens */
function reportStop(screen: 'link-lost' | 'link-refused', detail: string, report: typeof captureBrowserError): void {
  try {
    let build = ''; try { build = __BUILD_ID__; } catch { /* under Node */ }
    report(new Error(screen === 'link-lost' ? `Couldn't reconnect: ${detail}` : `The world turned this connection away: ${detail}`),
      { system: 'link', build, shard: '', bootStage: 'running', fatal: false, screen, diagnostic: { detail } });
  } catch { /* telemetry never stops the card */ }
}

/** Redial gives up after this long (`redial.ts` GIVE_UP_MS). */
const GIVE_UP_S = 120;
/** The Reconnected notice stays this long. */
const NOTICE_MS = 2500;
/** FM4b modes 21 and 22, sampled once a second while live: a pong RTT over this is slow; five in a row spanning this much are unstable. */
const SLOW_RTT_MS = 250, UNSTABLE_SPAN_MS = 250;
/** Mode 22: the share of frames the server says it skipped for this client (`lossPct`), not measured TCP loss. */
const UNSTABLE_LOSS_PCT = 5;
/** A quality chip shows after this many bad seconds in a row, clears after this many good ones, and shows at most once a minute. */
const QUALITY_SUSTAIN_S = 5, QUALITY_CLEAR_S = 10, QUALITY_GAP_S = 60;
/** After Keep waiting, a blocked tap pulses the banner instead of opening the card again, for this long. */
const QUIET_MS = 10_000;

const CSS = `
.ws-link{--c:#8fe3ff;--a:#ffb547;--r:#ff7a6c;--g:#7ef0b0;--t:var(--a);box-sizing:border-box;color:#e6f2f8;font:12px/1.5 'JetBrains Mono','SF Mono',Menlo,monospace;-webkit-user-select:none;user-select:none}
.ws-link *{box-sizing:border-box}.ws-link[data-tone=info]{--t:var(--c)}.ws-link[data-tone=bad]{--t:var(--r)}.ws-link[data-tone=good]{--t:var(--g)}
.ws-link[hidden]{display:none!important}
.ws-link button{appearance:none;-webkit-appearance:none;width:100%;min-height:48px;padding:13px 16px;cursor:pointer;font:700 12px/1 'JetBrains Mono',Menlo,monospace;letter-spacing:.22em;text-transform:uppercase;border:1px solid rgba(143,227,255,.35);background:rgba(143,227,255,.06);color:var(--c);touch-action:manipulation;display:flex;align-items:center;justify-content:center;gap:8px}
.ws-link button.go{border-color:var(--c);background:rgba(143,227,255,.18);color:#fff}.ws-link button:active{background:rgba(143,227,255,.26)}.ws-link button:disabled{opacity:.6}
.ws-link button:focus{outline:none}.ws-link button:focus-visible{outline:1px solid var(--c);outline-offset:3px}
.ws-link .ring{flex:none;display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:ws-link-spin .8s linear infinite}
@keyframes ws-link-spin{to{transform:rotate(360deg)}}
.ws-link-banner{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147482500;width:max-content;max-width:min(560px,calc(100% - 250px));display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 10px;padding:calc(7px + env(safe-area-inset-top,0px)) 16px 8px;background:linear-gradient(rgba(9,18,28,.95),rgba(9,18,28,.88));border:1px solid color-mix(in srgb,var(--t) 40%,transparent);border-top:0;border-bottom:2px solid var(--t);clip-path:polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0 calc(100% - 8px));box-shadow:0 6px 24px rgba(0,0,0,.4);text-align:center;pointer-events:none;animation:ws-link-tab .18s ease-out}
.ws-link-banner b{display:flex;align-items:center;gap:8px;font:700 14px/1.1 Rajdhani,'Bahnschrift',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#fff}.ws-link-banner b .ring{color:var(--t)}
.ws-link-banner>span{font-size:11px;letter-spacing:.04em;color:rgba(230,242,248,.78);font-variant-numeric:tabular-nums}
.ws-link-banner.pulse{animation:ws-link-pulse .5s ease-out}
@keyframes ws-link-tab{from{transform:translate(-50%,-100%)}}@keyframes ws-link-pulse{50%{box-shadow:0 0 0 3px var(--t),0 6px 24px rgba(0,0,0,.4)}}
.ws-link-notice{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top,0px));z-index:2147482300;transform:translateX(-50%);display:flex;align-items:center;gap:9px;padding:7px 12px;max-width:min(460px,calc(100% - 250px));background:rgba(13,27,38,.86);border:1px solid color-mix(in srgb,var(--t) 55%,transparent);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;pointer-events:none;animation:ws-link-rise .25s ease-out}
.ws-link-notice::before{content:'✓';color:var(--g);font-weight:700}.ws-link-notice b{color:#fff}.ws-link-notice span{color:var(--t);letter-spacing:.08em;text-transform:none}
.ws-link-scrim{position:fixed;inset:0;z-index:2147482400;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));background:rgba(4,9,14,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:ws-link-fade .16s ease-out}
.ws-link-box{position:relative;width:min(440px,100%);max-height:100%;overflow:auto;padding:22px 18px 16px;background:rgba(13,27,38,.86);border:1px solid rgba(143,227,255,.35);box-shadow:0 24px 80px rgba(0,0,0,.55);animation:ws-link-rise .2s ease-out}
.ws-link-tag{margin:0 0 10px;font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:var(--c)}
.ws-link-tag::before{content:'';display:inline-block;width:6px;height:6px;margin:0 10px 1px 0;background:var(--t);box-shadow:0 0 8px var(--t);vertical-align:middle}
.ws-link h1{margin:0 0 10px;font:700 24px/1.1 Rajdhani,'Bahnschrift',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#fff}
.ws-link-body{margin:0 0 14px;font-size:13px;line-height:1.55;color:rgba(230,242,248,.86)}
.ws-link-want{display:flex;align-items:center;gap:8px;margin:0 0 14px;padding:7px 10px;border:1px dashed color-mix(in srgb,var(--t) 60%,transparent);background:color-mix(in srgb,var(--t) 8%,transparent);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:rgba(230,242,248,.75)}
.ws-link-want b{color:#fff}.ws-link-want i{margin-left:auto;font-style:normal;color:var(--t)}
.ws-link-facts{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0;list-style:none}
.ws-link-facts li{display:flex;align-items:center;gap:7px;padding:5px 8px;border:1px solid color-mix(in srgb,var(--t) 45%,transparent);font-size:11px;letter-spacing:.08em;color:var(--t);font-variant-numeric:tabular-nums}
.ws-link-hold{margin:0 0 12px}.ws-link-hold p{margin:0 0 5px;font-size:11px;color:rgba(230,242,248,.75)}
.ws-link-hold div{height:3px;background:rgba(143,227,255,.12)}.ws-link-hold div i{display:block;height:100%;background:var(--t);transition:width 1s linear}
.ws-link-auto{margin:0 0 14px;padding:8px 10px;border-left:2px solid var(--g);background:rgba(126,240,176,.06);font-size:11.5px;line-height:1.5;color:rgba(230,242,248,.85)}
.ws-link-col{display:flex;flex-direction:column;gap:8px}
.ws-link details{margin-top:12px;padding-top:10px;border-top:1px solid rgba(143,227,255,.14)}
.ws-link summary{cursor:pointer;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:rgba(143,227,255,.7);list-style:none}
.ws-link details p{margin:8px 0 0;font-size:10.5px;color:rgba(230,242,248,.55);overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
@keyframes ws-link-fade{from{opacity:0}}@keyframes ws-link-rise{from{opacity:0;transform:translateY(8px)}}
.ws-link-notice{animation-name:ws-link-fade}
@media (max-width:420px){.ws-link-banner{max-width:calc(100% - 220px);padding-left:12px;padding-right:12px}.ws-link-banner b{letter-spacing:.08em}}
@media (min-width:700px){.ws-link-banner{max-width:min(620px,calc(100% - 440px))}.ws-link-box{padding:28px 26px 20px}.ws-link h1{font-size:28px}}
@media (prefers-reduced-motion:reduce){.ws-link,.ws-link *{animation:none!important;transition:none!important}}
`;

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
};
const ring = (): HTMLElement => { const node = make('span', 'ring'); node.setAttribute('aria-hidden', 'true'); return node; };

/** What the screens ask of the link and the page. */
export interface LinkScreenHooks {
  /** After `lost`: start the dial again. */
  readonly retry: () => void;
  /** Dial now instead of waiting out the backoff. */
  readonly dialNow: () => void;
  /** The dial's progress and why the link is down. */
  readonly progress: () => LinkProgress;
  readonly why: () => LinkCause;
  /** Open the Connection doctor (E7.5), naming the screen that asked. */
  readonly doctor?: (from: string) => void;
  /** Reload this page into the world, taking the seat back (another tab, a turned-away link). */
  readonly reload: () => void;
  /** FM4b modes 21 and 22: the link's measured pong RTT and the server's reported frame skips (`NetClient.stats`) */
  readonly stats?: () => TransportStats | undefined;
  /** S13: where a failed link's stop card reports (the browser error tracker; a test observes its own) */
  readonly report?: typeof captureBrowserError;
}
/** What the shell tells the screens, and asks of them. */
export interface LinkScreens {
  /** The link changed state (Redial's `onState`). */
  readonly link: (state: LinkState, reason?: string) => void;
  /** J174: a deploy is due. */
  readonly countdown: (countdown: Countdown) => void;
  /** Is the link carrying frames? Taps that need the world go through only then. */
  readonly live: () => boolean;
  /** A tap that needs the world, made while it's down: opens the hold card (or pulses the banner) and returns false. True when live. */
  readonly allow: (what: string) => boolean;
  /** A chat line typed while the link is down: held and sent in order on the first frame back. True when held. */
  readonly holdChat: (text: string, send: (text: string) => void, drop: () => void) => boolean;
  /** The page came back into view: the banner says why again. */
  readonly visible: () => void;
}

/** The banner's words and catalogue ids for a link that is down. */
function bannerFor(state: LinkState, cause: LinkCause, dials: number): { ids: string; tone: 'info' | 'warn'; title: string; line: string } {
  if (state === 'resuming') return { ids: 'resuming', tone: 'warn', title: 'Still reconnecting', line: 'we\'ll keep trying' };
  if (cause === 'restart') return { ids: 'restart', tone: 'info', title: 'Restarting', line: 'the world is back in a moment' };
  if (cause === 'updating') return { ids: 'updating', tone: 'info', title: 'Server updating', line: dials > 0 ? `try ${String(dials + 1)}` : 'back in a moment' };
  if (cause === 'hidden') return { ids: 'background-short', tone: 'warn', title: 'Reconnecting', line: 'welcome back' };
  if (cause === 'silent') return { ids: 'half-open', tone: 'warn', title: 'Reconnecting', line: dials > 0 ? `try ${String(dials + 1)}` : 'no word from the world' };
  return { ids: 'drop reset', tone: 'warn', title: 'Reconnecting', line: dials > 0 ? `try ${String(dials + 1)}` : 'one moment' };
}
const blockedIds = (ids: string): string => ids.split(' ').map(id => `${id}-blocked`).join(' ');

/** A card's frame: the scrim, the box, a tag and a title. The caller fills the rest. */
function card(scope: Scope, ids: string, tone: 'info' | 'warn' | 'bad', tag: string, title: string): { root: HTMLElement; box: HTMLElement } {
  const root = scope.ownNode(make('div', 'ws-link ws-link-scrim')), box = make('div', 'ws-link-box');
  root.dataset['failmode'] = ids; root.dataset['tone'] = tone; root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', title);
  box.append(make('p', 'ws-link-tag', tag), make('h1', '', title)); root.append(box);
  // aria-modal: Tab and Shift+Tab go round the card's own buttons (InputService leaves Tab to an alertdialog)
  scope.listen(root, 'keydown', event => {
    if (!(event instanceof KeyboardEvent) || event.code !== 'Tab') return;
    // everything Tab can reach in the card: its enabled buttons and the Details summary
    const all = [...root.querySelectorAll<HTMLElement>('button, summary')].filter(node => !(node instanceof HTMLButtonElement && node.disabled));
    const first = all[0], last = all.at(-1), at = document.activeElement;
    if (first === undefined || last === undefined) { event.preventDefault(); return; }
    const inside = at instanceof HTMLElement && all.includes(at);
    if (event.shiftKey && (at === first || !inside)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (at === last || !inside)) { event.preventDefault(); first.focus(); }
  });
  return { root, box };
}
function buttons(scope: Scope, actions: readonly { readonly label: string; readonly primary?: true; readonly busy?: string; readonly act: () => void }[]): HTMLElement {
  const column = make('div', 'ws-link-col');
  for (const action of actions) {
    const button = make('button', action.primary === true ? 'go' : '', action.label);
    button.type = 'button';
    if (action.label === 'Check connection') button.dataset['doctor'] = 'open';
    // RL3: the tapped button turns busy in the tap's own turn
    scope.listen(button, 'click', () => { if (action.busy !== undefined) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.replaceChildren(ring(), make('span', '', action.busy)); } action.act(); });
    column.append(button);
  }
  return column;
}

/**
 * FM4: the link's screens. Returns what the shell calls. Nothing here changes how the link redials: it only says so, and holds taps.
 *
 *   const screens = linkScreens(scope, { retry, dialNow, progress, why, doctor, reload });
 *   new Redial({ …, onState: screens.link });
 *   if (!screens.allow('Talk')) return;   // a tap the world must hear
 */
export function linkScreens(scope: Scope, hooks: LinkScreenHooks, parent: HTMLElement = document.body): LinkScreens {
  const report = hooks.report ?? captureBrowserError;
  // the stylesheet lives as long as the document: a second shell (a reload in place) shares it
  if (document.getElementById('ws-link-style') === null) { const style = make('style'); style.id = 'ws-link-style'; style.textContent = CSS; document.head.append(style); }
  // the banner keeps the old strip's id, so the online proofs still find it
  const banner = scope.ownNode(make('div', 'ws-link ws-link-banner')), head = make('b'), line = make('span');
  banner.id = 'ws-reconnect-strip'; banner.setAttribute('role', 'status'); banner.hidden = true; banner.append(head, line);
  const deploy = scope.ownNode(make('div', 'ws-link ws-link-banner')), deployLine = make('span');
  deploy.id = 'ws-countdown-strip'; deploy.dataset['failmode'] = 'deploy'; deploy.dataset['tone'] = 'info'; deploy.setAttribute('role', 'status'); deploy.hidden = true;
  deploy.append(make('b', '', 'World update'), deployLine);
  parent.append(banner, deploy);

  let state: LinkState = 'live', reason: string | undefined, wasDown = false, quietUntil = 0, deployLeft = 0, deployTicking = false;
  let open: { scope: Scope; root: HTMLElement; kind: 'hold' | 'stop' | 'offline'; paint: () => void; what?: string; chat?: boolean; key?: string } | null = null;
  const held: { text: string; send: (text: string) => void; drop: () => void }[] = [];
  const down = (): boolean => state === 'reconnecting' || state === 'resuming';

  // focus goes back where it was before the first card opened (the chat box, the canvas) when the last one closes
  let returnTo: HTMLElement | null = null;
  const close = (): void => { open?.scope.dispose(); open = null; if (returnTo?.isConnected === true) returnTo.focus(); returnTo = null; };
  const remember = (): void => { if (open === null && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) returnTo = document.activeElement; };
  // a card takes the pointer back from the game (desktop pointer lock), so its buttons can be clicked
  const freePointer = (): void => { if ('exitPointerLock' in document && document.pointerLockElement instanceof Element) document.exitPointerLock(); };
  const paintBanner = (): void => {
    // offline, the card is the screen (FM4b mode 2): no banner under it
    const shown = down() && hooks.why() !== 'offline';
    banner.hidden = !shown;
    // a link that is down takes the top band from the deploy countdown; the countdown comes back with the link
    deploy.hidden = down() || deployLeft <= 0;
    if (!shown) return;
    const said = bannerFor(state, hooks.why(), hooks.progress().dials);
    banner.dataset['failmode'] = said.ids; banner.dataset['tone'] = said.tone; banner.dataset['state'] = state;
    head.replaceChildren(ring(), said.title); line.textContent = said.line;
  };
  let noticeScope: Scope | null = null;
  const unnotice = (): void => { noticeScope?.dispose(); noticeScope = null; };
  const notice = (): void => {
    unnotice();
    const own = noticeScope = scope.child('online.notice'), chip = own.ownNode(make('div', 'ws-link ws-link-notice'));
    chip.dataset['failmode'] = 'reconnected'; chip.dataset['tone'] = 'good'; chip.setAttribute('role', 'status');
    chip.append(make('b', '', 'Reconnected'), make('span', '', 'you\'re back online'));
    parent.append(chip);
    own.timeout(NOTICE_MS, unnotice);
  };
  /** The hold card: the banner opened up, on a tap it can't carry. It repaints each second from the dial's progress. */
  const hold = (what: string, chat: boolean): void => {
    // the offline card already says why nothing goes out; a held chat line still waits for the link
    if (open?.kind === 'stop' || open?.kind === 'offline') return;
    remember(); open?.scope.dispose(); open = null;
    const own = scope.child('online.hold'), said = bannerFor(state, hooks.why(), hooks.progress().dials);
    const title = chat ? 'Your message will send when you\'re back' : state === 'resuming' ? 'Still reconnecting' : hooks.why() === 'restart' ? 'The world is restarting' : 'Not connected yet';
    const { root, box } = card(own, blockedIds(chat ? 'reset' : said.ids), said.tone, said.title, title);
    const want = make('p', 'ws-link-want');
    want.append('You tapped ', make('b', '', what), make('i', '', chat ? 'held' : 'on hold'));
    box.prepend(want);
    const body = make('p', 'ws-link-body'), facts = make('ul', 'ws-link-facts'), tries = make('li'), next = make('li'), holdBox = make('div', 'ws-link-hold'), holdLine = make('p'), track = make('div'), fill = make('i');
    facts.setAttribute('role', 'status'); track.append(fill); holdBox.append(holdLine, track); facts.append(tries, next);
    body.textContent = chat ? 'The link to the world dropped. Your latest message is kept, marked unsent; a new one replaces it.'
      : `${what} needs the world, and the link is down. We're dialling again by ourselves.`;
    const auto = make('p', 'ws-link-auto', chat ? 'It sends itself as soon as the link is back. Game taps are never sent late.'
      : 'This closes by itself when the link is back. Tap again then: we never send a tap late.');
    box.append(body, facts, holdBox, auto, buttons(own, [
      { label: 'Try now', primary: true, busy: 'Dialling…', act: () => { hooks.dialNow(); } },
      chat ? { label: 'Don\'t send it', act: () => { for (const kept of held.splice(0)) kept.drop(); close(); quietUntil = diagnosticNow() + QUIET_MS; } }
        : { label: 'Keep waiting', act: () => { close(); quietUntil = diagnosticNow() + QUIET_MS; } },
    ]));
    const paint = (): void => {
      const { dials, nextDialMs, downMs } = hooks.progress(), downS = Math.floor(downMs / 1000);
      tries.replaceChildren(ring(), dials > 0 ? `Try ${String(dials + 1)}` : 'Checking the link');
      next.textContent = nextDialMs !== null ? `Next dial in ${String(Math.ceil(nextDialMs / 1000))} s` : downMs === 0 ? 'Listening for the world' : 'Dialling now';
      // J229 and the Codex plan review: only what this page measured. No server hold or save time is claimed: the bar is the
      // page's own give-up clock (Redial's 120 s), and the line says how long the world has been quiet
      const left = Math.max(0, GIVE_UP_S - downS);
      holdLine.textContent = downMs === 0 ? 'No word from the world for a moment' : `Down for ${String(downS)} s · we'll keep trying for ${String(left)} s more`;
      fill.style.width = `${String(Math.round(left / GIVE_UP_S * 100))}%`;
    };
    paint(); own.interval(1000, paint);
    parent.append(root); freePointer();
    open = { scope: own, root, kind: 'hold', paint, what, chat, key: `${state}:${hooks.why()}` };
    root.querySelector('button')?.focus();
  };
  /** A card that stops play: the link gave up, the world is full, another tab, turned away. */
  const stop = (ids: string, tone: 'info' | 'warn' | 'bad', tag: string, title: string, body: string, actions: Parameters<typeof buttons>[1], detail?: string, live?: (node: HTMLElement) => void): void => {
    remember(); open?.scope.dispose(); open = null;
    const own = scope.child('online.card'), { root, box } = card(own, ids, tone, tag, title);
    box.append(make('p', 'ws-link-body', body));
    if (live !== undefined) { const status = make('p', 'ws-link-facts'); status.setAttribute('role', 'status'); live(status); own.interval(1000, () => { live(status); }); box.append(status); }
    box.append(buttons(own, actions));
    if (detail !== undefined) { const details = make('details'); details.append(make('summary', '', 'Details'), make('p', '', detail)); box.append(details); }
    parent.append(root); freePointer();
    open = { scope: own, root, kind: 'stop', paint: () => undefined };
    root.querySelector('button')?.focus();
  };
  const doctor = (from: string): { label: string; busy: string; act: () => void }[] => hooks.doctor === undefined ? [] : [{ label: 'Check connection', busy: 'Opening…', act: () => { hooks.doctor?.(from); } }];
  /**
   * FM4b mode 2 (`offline-play`): the device says it has no network. Play waits under the card, the dial waits for the network
   * (Redial's `offline`), and the card closes by itself when the network is back (the banner takes over) or the link is.
   * J229: no seat-hold or save time is claimed, only what this page measured.
   */
  const offlineCard = (): void => {
    if (open?.kind === 'offline') return;
    remember(); open?.scope.dispose(); open = null;
    const own = scope.child('online.offline'), { root, box } = card(own, 'offline-play', 'warn', 'Connection dropped', 'You\'re offline');
    box.append(make('p', 'ws-link-body', 'This device lost its internet connection. The world needs it to carry on.'));
    const status = make('ul', 'ws-link-facts'), waiting = make('li');
    status.setAttribute('role', 'status'); status.append(waiting);
    const paint = (): void => { waiting.replaceChildren(ring(), `Down for ${String(Math.floor(hooks.progress().downMs / 1000))} s`); };
    paint(); own.interval(1000, paint);
    box.append(status, make('p', 'ws-link-auto', 'We\'ll connect again by ourselves as soon as the network is back. Nothing is sent while you\'re offline.'));
    const actions = doctor('offline-play');
    if (actions.length > 0) box.append(buttons(own, actions));
    const details = make('details'); details.append(make('summary', '', 'Details'), make('p', '', 'navigator.onLine is false · dialling waits for "online"')); box.append(details);
    parent.append(root); freePointer();
    open = { scope: own, root, kind: 'offline', paint };
    root.querySelector('button')?.focus();
  };

  /**
   * FM4b modes 21 (`slow`) and 22 (`lossy`): a notice chip in the top band while the link is live and measurably slow or unstable.
   * Only what the page measured: the pong RTT, the spread of the last five, the server's `lossPct`. Never a guessed cause or a made-up
   * percentage. A chip waits while a banner is up (it is the bottom layer) and comes back, if still due, with the link.
   */
  const rtts: number[] = [];
  let slowRun = 0, unstableRun = 0, goodRun = 0, sinceChip = QUALITY_GAP_S, qualityScope: Scope | null = null, qualityKind: 'slow' | 'lossy' | null = null, qualityLine: HTMLElement | null = null;
  const hideQuality = (): void => { qualityScope?.dispose(); qualityScope = null; qualityKind = null; qualityLine = null; };
  const showQuality = (kind: 'slow' | 'lossy', rtt: number): void => {
    if (qualityKind !== kind) {
      hideQuality(); unnotice();
      const own = qualityScope = scope.child('online.quality'), chip = own.ownNode(make('div', 'ws-link ws-link-notice'));
      chip.dataset['failmode'] = kind; chip.dataset['tone'] = 'warn'; chip.setAttribute('role', 'status');
      qualityLine = make('span');
      chip.append(make('b', '', kind === 'slow' ? 'Slow connection' : 'Unstable connection'), qualityLine);
      parent.append(chip);
      qualityKind = kind; sinceChip = 0;
    }
    if (qualityLine !== null) qualityLine.textContent = kind === 'slow' ? `${String(Math.round(rtt))} ms` : 'others may jump';
  };
  const sampleQuality = (): void => {
    sinceChip++;
    const stats = hooks.stats?.();
    if (stats === undefined || state !== 'live') { hideQuality(); slowRun = unstableRun = goodRun = 0; rtts.length = 0; return; }
    const rtt = stats.rttMs;
    if (Number.isFinite(rtt) && rtt > 0) { rtts.push(rtt); if (rtts.length > 5) rtts.shift(); }
    const slow = Number.isFinite(rtt) && rtt > SLOW_RTT_MS;
    const unstable = (rtts.length === 5 && Math.max(...rtts) - Math.min(...rtts) >= UNSTABLE_SPAN_MS) || stats.lossPct >= UNSTABLE_LOSS_PCT;
    slowRun = slow ? slowRun + 1 : 0; unstableRun = unstable ? unstableRun + 1 : 0; goodRun = slow || unstable ? 0 : goodRun + 1;
    const due = slowRun >= QUALITY_SUSTAIN_S ? 'slow' : unstableRun >= QUALITY_SUSTAIN_S ? 'lossy' : null;
    if (qualityKind !== null) { if (goodRun >= QUALITY_CLEAR_S) hideQuality(); else showQuality(due ?? qualityKind, rtt); return; }
    if (due !== null && sinceChip >= QUALITY_GAP_S) showQuality(due, rtt);
  };
  scope.interval(1000, sampleQuality);
  const link = (next: LinkState, why?: string): void => {
    state = next; reason = why;
    if (state !== 'live') hideQuality();
    paintBanner();
    // down again: the notice goes, and a stop card (lost, after Try again) gives way to the banner
    if (down()) {
      wasDown = true; unnotice();
      if (open?.kind === 'stop') close();
      if (hooks.why() === 'offline') { offlineCard(); return; }
      if (open?.kind === 'offline') close();
      // a hold card follows its banner: a new cause (silent to restart) or 35 s down redraws it, else it just ticks
      if (open?.kind === 'hold' && open.key !== `${state}:${hooks.why()}` && open.what !== undefined) hold(open.what, open.chat === true); else open?.paint();
      return;
    }
    if (state === 'live') {
      close();
      if (wasDown) notice();
      wasDown = false;
      for (const kept of held.splice(0)) kept.send(kept.text);
      return;
    }
    if (state === 'ended') for (const kept of held.splice(0)) kept.drop();
    if (state === 'lost') {
      reportStop('link-lost', `${String(hooks.progress().dials)} dials · last close: ${hooks.why()}`, report);
      stop('lost', 'bad', 'Connection lost', 'Couldn\'t reconnect', 'We tried for 2 minutes and the world didn\'t answer. Anything the world hadn\'t saved yet may need doing again.',
        [{ label: 'Try again', primary: true, busy: 'Reconnecting…', act: () => { hooks.retry(); } }, ...doctor('lost')], `${String(hooks.progress().dials)} dials · last close: ${hooks.why()}`);
    } else if (state === 'full') {
      stop('full', 'warn', 'World is full', 'The world is full', 'Every place is taken. We\'ll ask every 30 seconds and let you in as soon as someone leaves.', doctor('full'),
        'close "full" (4002)', status => { const ms = hooks.progress().nextDialMs; status.textContent = ms === null ? 'Asking now' : `Next try in ${String(Math.ceil(ms / 1000))} s`; });
    } else if (state === 'ended' && reason === 'replaced') {
      stop('replaced', 'info', 'Another tab', 'Playing somewhere else', 'This world is open in another tab or on another device. Only one can play at a time.',
        [{ label: 'Play here', primary: true, busy: 'Joining…', act: () => { hooks.reload(); } }], 'close "replaced" (4003)');
    } else if (state === 'ended' && reason !== 'reload') {
      reportStop('link-refused', `close "${String(reason)}"`, report);
      stop('refused', 'bad', 'Turned away', 'The world turned this connection away', 'The server ended this link and won\'t take it back by itself.',
        [{ label: 'Play again', primary: true, busy: 'Joining…', act: () => { hooks.reload(); } }, ...doctor('lost')], `close "${String(reason)}"`);
    }
  };
  return {
    link,
    countdown: said => {
      deployLeft = said.seconds;
      const paint = (): void => { deployLine.textContent = `in ${String(deployLeft)} s · preparing to move`; deploy.hidden = down() || deployLeft <= 0; };
      paint();
      if (deployTicking) return;
      deployTicking = true;
      scope.interval(1000, () => { deployLeft = Math.max(0, deployLeft - 1); paint(); });
    },
    live: () => state === 'live',
    allow: what => {
      if (state === 'live') return true;
      if (!down() || what === '') return false;
      if (open === null && diagnosticNow() >= quietUntil) hold(what, false);
      else { banner.classList.remove('pulse'); void banner.offsetWidth; banner.classList.add('pulse'); }
      return false;
    },
    holdChat: (text, send, drop) => {
      // live: send now. Ended: nothing will carry it, and the card already says why
      if (state === 'live' || state === 'ended') return false;
      // one held draft at a time (J229, the plan's 16b): a new line replaces the one waiting
      for (const kept of held.splice(0)) kept.drop();
      held.push({ text, send, drop });
      if (down() && open?.kind !== 'stop') hold('Send', true);
      return true;
    },
    visible: () => { paintBanner(); },
  };
}
