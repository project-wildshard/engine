import type { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { listenPage } from '@wildshard/engine/input/dom';
import type { NetClient } from '@wildshard/engine/net/client';
import { CHAT_FADE_MS, CHAT_FRESH_MS, CHAT_KEPT, cornerOpen, lineLook, type CornerEvent } from './chatCorner';

/** Lines the calm corner can show at once (only fresh ones show there). Room chat is for a sitting of two (Q88). */
const SHOWN = 6;
/** A14 (Jake, 2026-11-10: "move the chat bar to just above the bottom HUD, bottom left, directly above MOVE"; QA row 15: "when the
 *  menu is open, can we just hide the chat and the audio?"). On a touch screen the row sits over MOVE as wide as MOVE, above the
 *  stick's SPRINT tag and first hint, with the voice tip and the lines over it (voiceUi.ts appends the mic and the tip; `order`
 *  places them). A disc in MOVE's corner of the thumb row (Sky Reach's GUST, a ride's lean) lifts it over that row, and the USE
 *  band yields MOVE's column to it (touch.css). It is never taller than the room under the left edge's HOVER / SWAP column, so
 *  the oldest lines clip first. Landscape steps it right of that column. A keyboard page puts it bottom left too (Jake, 2026-11-10
 *  ~23:15 Cancún: "fix the position of chat and microphones in desktop mode too"; it sat top left under the quest chip):
 *  over what stands there (the coins, a steed's row, the health readout, a desktop's Developer alerts), measured (`place`).
 *  The open chat keeps at least 240 px: in a short window it drops over those, as an open chat does on a phone.
 *  The touch HUD's place follows the touch HUD itself (`#hud.touch`), so Settings' Touch controls on a mouse get it too. Any menu or panel over the world hides it all
 *  (`data-ws-menu` on the root, src/client/engine/ui/layers.ts); voice stays connected.
 *  QA row 43 (chatCorner.ts): the corner is calm. Only the input and the mic stay; a line shows as it is said and fades after
 *  5 s, and lets taps through to the game. Focusing the input opens the chat (`data-open`): a larger panel with the history,
 *  each line's Report, and the players on voice with their mute (voiceUi.ts). A tap outside it, its ×, Escape or an empty
 *  Enter closes it. It is not a modal: the game runs on, and a tap outside reaches the game as well as closing the chat. */
const CSS = `
#ws-chat{--ws-chat-bar:calc(max(15vh,104px) + max(env(safe-area-inset-bottom,0px),var(--ws-home,0px)) * .5);--ws-chat-gap:46px;--ws-chat-lift:132px;position:fixed;left:8px;top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + var(--ws-chat-lift));max-height:calc(100vh - var(--ws-chat-lift) - 120px);z-index:900;width:min(56vw,260px);display:flex;flex-direction:column;justify-content:flex-end;gap:4px;font:500 13px/1.3 system-ui,sans-serif;color:#fff;pointer-events:none}
#ws-chat>[data-head]{display:none}
#ws-chat>[data-lines]{order:1;flex-shrink:100;display:flex;flex-direction:column;justify-content:flex-end;gap:4px;min-height:0;overflow:hidden}
#ws-chat>#ws-voice-peers{order:2;min-height:0;overflow:hidden}
#ws-chat>#ws-voice-tip{order:3;min-height:0;overflow:hidden}
#ws-chat>form{order:4;flex:none}
#ws-chat [data-lines]>*{display:flex;gap:6px;align-items:baseline;padding:2px 6px;border-radius:6px;background:rgba(8,14,24,.8);overflow-wrap:anywhere;pointer-events:none}
#ws-chat [data-lines]>[data-look=fresh]{animation:ws-chat-in .25s ease-out}
@keyframes ws-chat-in{from{opacity:0;transform:translateY(4px)}}
#ws-chat:not([data-open]) [data-lines]>[data-look=fading]{opacity:0;transition:opacity ${String(CHAT_FADE_MS)}ms ease-in}
#ws-chat:not([data-open]) [data-lines]>[data-look=gone],#ws-chat:not([data-open]) [data-lines] button,#ws-chat:not([data-open])>#ws-voice-peers{display:none}
:root[data-ws-menu] #ws-chat{display:none}
#ws-chat[data-open]{--ws-chat-open-lift:min(var(--ws-chat-lift),calc(100vh - 264px - env(safe-area-inset-top,0px)));bottom:calc(env(safe-area-inset-bottom,0px) + max(8px,var(--ws-chat-open-lift)));z-index:950;pointer-events:auto;justify-content:flex-start;gap:8px;width:min(calc(100vw - 16px),440px);height:min(calc(100vh - max(8px,var(--ws-chat-open-lift)) - 24px - env(safe-area-inset-top,0px)),560px);max-height:none;padding:8px;box-sizing:border-box;border:1px solid rgba(143,227,255,.35);border-radius:12px;background:rgba(6,12,22,.92);box-shadow:0 10px 32px rgba(0,0,0,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
#ws-chat[data-open]>[data-head]{order:0;display:flex;align-items:center;gap:8px;flex:none;padding:0 2px 0 4px;color:#9fb3c8;font:700 11px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase}
#ws-chat[data-open]>[data-head] button{margin-left:auto;width:32px;height:32px;border:1px solid rgba(143,227,255,.3);border-radius:8px;background:rgba(8,14,24,.7);color:#dff6ff;font:400 20px/1 system-ui,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}
#ws-chat[data-open]>#ws-voice-peers{order:1;flex:none;max-height:40%;overflow-y:auto}
#ws-chat[data-open]>[data-lines]{order:2;flex:1 1 auto;justify-content:flex-start;overflow-y:auto;overscroll-behavior:contain}
#ws-chat[data-open]>[data-lines]>:first-child{margin-top:auto}
#ws-chat[data-open] [data-lines]>*{pointer-events:auto;animation:none}
#ws-chat[data-open] [data-lines]:empty::before{content:'No messages yet. Say hello.';margin-top:auto;color:#7d8d9c;font-size:12px;padding:2px 6px}
#ws-chat[data-touch]{top:calc(var(--ws-vh,100vh) - var(--ws-chat-bar) - var(--ws-chat-gap));bottom:auto;transform:translateY(-100%);left:calc(env(safe-area-inset-left,0px) + 8px);width:calc(45vw - 16px);max-height:calc(var(--ws-vh,100vh) * .54 - var(--ws-chat-bar) - var(--ws-chat-gap) - 103px)}
:root:has(.ws-touch .ws-touch-disc.at-lean-l.show) #ws-chat[data-touch]{--ws-chat-gap:calc(min(15vw,84px) + 18px)}
#ws-chat[data-touch][data-open]{top:calc(env(safe-area-inset-top,0px) + 56px);bottom:auto;transform:none;max-height:none;width:calc(100vw - 16px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));height:min(calc(var(--ws-chat-vv,var(--ws-vh,100vh)) - env(safe-area-inset-top,0px) - 68px),calc(var(--ws-vh,100vh) * .52))}
@media (orientation:landscape){
#ws-chat[data-touch]{left:calc(env(safe-area-inset-left,0px) + 68px);width:min(calc(45vw - 76px),300px);max-height:calc(var(--ws-vh,100vh) - var(--ws-chat-bar) - var(--ws-chat-gap) - 190px)}
#ws-chat[data-touch][data-open]{width:min(calc(100vw - 84px),440px);height:calc(var(--ws-chat-vv,var(--ws-vh,100vh)) - env(safe-area-inset-top,0px) - 68px)}
}
`;
/** What stands at a keyboard page's bottom left, which the corner sits over: the coins, a steed's row, the health readout, and
 *  on a desktop the Developer alerts (perf.css). Measured, because a steed's row or a many-line alert has no fixed height. */
const UNDER = '#hud > .ws-loot-chip, #hud .ws-ride-steed.show, #hud .ws-game-health, .ws-perf-panel';
/** The gap over them, and how often the corner looks again. */
const UNDER_GAP = 10, PLACE_EVERY_MS = 500;
/** The input row's height and its margin to the top edge: the most the corner may be lifted leaves this much. */
const CHAT_ROW_PX = 64;
/** The touch HUD's place (over MOVE) wherever the touch HUD is up, a phone's or one Settings turned on; a keyboard page's over
 *  whatever stands at its bottom left. */
function place(box: HTMLElement): void {
  const touch = document.querySelector('#hud.touch') !== null || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  if (touch !== (box.dataset['touch'] !== undefined)) { if (touch) box.dataset['touch'] = ''; else delete box.dataset['touch']; }
  if (touch) return;
  const right = box.getBoundingClientRect().right, floor = innerHeight / 2;
  let lift = 0;
  for (const under of document.querySelectorAll(UNDER)) {
    const r = under.getBoundingClientRect();
    // a box standing on the bottom half, however tall (a many-line Developer alert can reach past the middle)
    if (r.width > 0 && r.height > 0 && r.bottom > floor && r.left < right) lift = Math.max(lift, innerHeight - r.top + UNDER_GAP);
  }
  // the input and mic always keep a row on screen, even over an alert taller than the window allows
  const value = `${String(Math.round(Math.min(Math.max(lift, UNDER_GAP), innerHeight - CHAT_ROW_PX)))}px`;
  if (box.style.getPropertyValue('--ws-chat-lift') !== value) box.style.setProperty('--ws-chat-lift', value);
}
const REPORT = 'flex:none;margin-left:auto;padding:0 6px;border:0;background:none;color:#8fe3ff;font:inherit;font-size:11px;cursor:pointer';
const FIELD = 'pointer-events:auto;flex:1;min-width:0;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid rgba(143,227,255,.5);border-radius:6px;background:rgba(9,22,36,.94);color:#fff;font:16px/1.2 system-ui,sans-serif';

/** The chat box's parts, so voice can sit in its row (J218), and whether it is open (QA row 43). */
export interface ChatBox { readonly box: HTMLElement; readonly form: HTMLFormElement; readonly isOpen: () => boolean }
/** E7.6 (Q88): room chat, with a report on every line someone else said. The input takes a phone's own keyboard, at 16 px so iOS doesn't zoom.
 *  `hold` (FM4) takes a line typed while the link is down: it shows as unsent and goes out in order when the link is back. */
export function chatLines(scope: Scope, client: NetClient, parent: HTMLElement = document.body, hold?: (text: string, send: (text: string) => void, drop: () => void) => boolean): ChatBox {
  const box = scope.ownNode(document.createElement('div')), list = document.createElement('div'), form = document.createElement('form'), field = document.createElement('input');
  const head = document.createElement('div'), title = document.createElement('span'), close = document.createElement('button');
  const style = scope.ownNode(document.createElement('style'));
  style.textContent = CSS; document.head.append(style);
  box.id = 'ws-chat'; list.dataset['lines'] = ''; form.style.cssText = 'display:flex;gap:6px;align-items:center;margin:0';
  head.dataset['head'] = ''; title.textContent = 'Chat';
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close chat');
  head.append(title, close);
  field.placeholder = 'Say something'; field.enterKeyHint = 'send'; field.autocomplete = 'off'; field.style.cssText = FIELD;
  form.append(field); box.append(head, list, form); parent.append(box);

  let open = false;
  /** The keyboard's top, on a phone: the open chat ends above it (the layout viewport doesn't shrink for it on iOS). */
  const fit = (): void => {
    const view = typeof visualViewport === 'undefined' ? null : visualViewport;
    if (view === null) return;
    box.style.setProperty('--ws-chat-vv', `${String(Math.round(view.height + view.offsetTop))}px`);
  };
  const toBottom = (): void => { list.scrollTop = list.scrollHeight; };
  const corner = (event: CornerEvent): void => {
    const next = cornerOpen(open, event);
    if (next === open) return;
    open = next;
    box.toggleAttribute('data-open', open);
    // the open chat keeps Escape for itself (InputService lets it be), from its input or any of its buttons
    box.toggleAttribute('data-ws-own-escape', open);
    const focused = document.activeElement;
    if (open) { fit(); toBottom(); } else if (focused instanceof HTMLElement && box.contains(focused)) focused.blur();
  };
  scope.listen(field, 'focus', () => { corner('focus'); });
  scope.listen(close, 'click', () => { corner('close'); });
  // Escape on a focused Mute or Report button (the input's own Escape is handled below, where its keys stop)
  scope.listen(box, 'keydown', event => { if (open && event instanceof KeyboardEvent && event.key === 'Escape') { event.preventDefault(); corner('close'); } });
  if (typeof visualViewport !== 'undefined' && visualViewport !== null) scope.listen(visualViewport, 'resize', () => { if (open) fit(); });
  place(box); scope.interval(PLACE_EVERY_MS, () => { place(box); });
  // a tap anywhere else closes it, and still reaches the game: nothing here stops it (not a modal)
  listenPage(scope, 'pointerdown', event => {
    if (!open) return;
    corner(event.target instanceof Node && box.contains(event.target) ? 'inside' : 'outside');
  }, { capture: true, on: 'document' });
  // What's typed here is chat, not a walk: the game reads its keys further up. Escape leaves chatting.
  for (const name of ['keydown', 'keyup', 'keypress']) scope.listen(field, name, event => {
    event.stopPropagation();
    if (name === 'keydown' && event instanceof KeyboardEvent && event.key === 'Escape') { event.preventDefault(); corner('close'); }
  });

  /** A line shows fresh, fades after CHAT_FRESH_MS and is gone from the calm corner CHAT_FADE_MS later. */
  const said = (row: HTMLElement): void => {
    const at = diagnosticNow(), paint = (): void => { row.dataset['look'] = lineLook(at, diagnosticNow()); };
    row.dataset['look'] = 'fresh';
    scope.timeout(CHAT_FRESH_MS, paint);
    scope.timeout(CHAT_FRESH_MS + CHAT_FADE_MS, paint);
  };
  const add = (row: HTMLElement): void => {
    const pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
    list.append(row);
    while (list.childElementCount > CHAT_KEPT) list.firstElementChild?.remove();
    // the calm corner never holds more than SHOWN fresh lines: older ones go before their time
    const fresh = [...list.children].filter(child => child instanceof HTMLElement && child.dataset['look'] === 'fresh');
    for (const old of fresh.slice(0, Math.max(0, fresh.length - SHOWN))) if (old instanceof HTMLElement && old.dataset['unsent'] === undefined) old.dataset['look'] = 'gone';
    if (pinned) toBottom();
  };
  scope.listen(form, 'submit', event => {
    event.preventDefault();
    const text = field.value.trim();
    if (text === '') { corner('empty'); return; }
    const row = document.createElement('div');
    const send = (line: string): void => { row.remove(); client.say('room', line); };
    if (hold?.(text, send, () => { row.remove(); }) === true) {
      // an unsent line stays in the corner until it goes out or is dropped
      row.style.opacity = '.6'; row.dataset['unsent'] = 'true'; row.dataset['look'] = 'fresh'; row.textContent = `${text} · unsent`;
      add(row);
    } else client.say('room', text);
    field.value = '';
    // chatting mode stays open to say more; a line sent from the calm corner (a key that never opened it) leaves the field
    if (open) corner('sent'); else field.blur();
  });
  const own = (): string | undefined => client.welcome === null ? undefined : String(client.welcome.handle);
  scope.onDispose(client.onChat(({ line, from, name, text }) => {
    const row = document.createElement('div'), words = document.createElement('span');
    row.dataset['line'] = String(line); words.textContent = `${name}: ${text}`;
    row.append(words);
    if (String(from) !== own()) {
      const report = document.createElement('button');
      report.type = 'button'; report.textContent = 'Report'; report.style.cssText = REPORT;
      scope.listen(report, 'click', () => { client.report(line); report.textContent = 'Reported'; report.disabled = true; });
      row.append(report);
    }
    said(row); add(row);
  }));
  return { box, form, isOpen: () => open };
}
