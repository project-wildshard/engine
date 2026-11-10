import type { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';

/** Lines kept on screen. Room chat is for a sitting of two (Q88), so a long history would only cover the world. */
const SHOWN = 6;
/** A14 (Jake, 2026-11-10: "move the chat bar to just above the bottom HUD, bottom left, directly above MOVE"; QA row 15: "when the
 *  menu is open, can we just hide the chat and the audio?"). On a touch screen the row sits over MOVE as wide as MOVE, above the
 *  stick's SPRINT tag and first hint, with the voice tip, the players on voice and the lines over it (voiceUi.ts appends the
 *  first two; `order` places them). A disc in MOVE's corner of the thumb row (Sky Reach's GUST, a ride's lean) lifts it over
 *  that row, and the USE band yields MOVE's column to it (touch.css). It is never taller than the room under the left edge's
 *  HOVER / SWAP column, so the oldest lines clip first. Landscape steps it right of that column. Any menu or panel over the
 *  world hides it all (`data-ws-menu` on the root, src/client/engine/ui/layers.ts); voice stays connected. */
const CSS = `
#ws-chat{--ws-chat-bar:calc(max(15vh,104px) + max(env(safe-area-inset-bottom,0px),var(--ws-home,0px)) * .5);--ws-chat-gap:46px;position:fixed;left:8px;top:calc(env(safe-area-inset-top,0px) + 92px);z-index:900;width:min(56vw,260px);display:flex;flex-direction:column;justify-content:flex-end;gap:4px;font:500 13px/1.3 system-ui,sans-serif;color:#fff;pointer-events:none}
#ws-chat>[data-lines]{order:1;flex-shrink:100;display:flex;flex-direction:column;justify-content:flex-end;gap:4px;min-height:0;overflow:hidden}
#ws-chat>#ws-voice-peers{order:2;min-height:0;overflow:hidden}
#ws-chat>#ws-voice-tip{order:3;min-height:0;overflow:hidden}
#ws-chat>form{order:4;flex:none}
:root[data-ws-menu] #ws-chat{display:none}
@media (pointer:coarse){
#ws-chat{top:calc(var(--ws-vh,100vh) - var(--ws-chat-bar) - var(--ws-chat-gap));transform:translateY(-100%);left:calc(env(safe-area-inset-left,0px) + 8px);width:calc(45vw - 16px);max-height:calc(var(--ws-vh,100vh) * .54 - var(--ws-chat-bar) - var(--ws-chat-gap) - 103px)}
:root:has(.ws-touch .ws-touch-disc.at-lean-l.show) #ws-chat{--ws-chat-gap:calc(min(15vw,84px) + 18px)}
}
@media (pointer:coarse) and (orientation:landscape){
#ws-chat{left:calc(env(safe-area-inset-left,0px) + 68px);width:min(calc(45vw - 76px),300px);max-height:calc(var(--ws-vh,100vh) - var(--ws-chat-bar) - var(--ws-chat-gap) - 190px)}
}
`;
const LINE = 'display:flex;gap:6px;align-items:baseline;padding:2px 6px;border-radius:6px;background:rgba(8,14,24,.8);pointer-events:auto;overflow-wrap:anywhere';
const REPORT = 'flex:none;margin-left:auto;padding:0 6px;border:0;background:none;color:#8fe3ff;font:inherit;font-size:11px';
const FIELD = 'pointer-events:auto;flex:1;min-width:0;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid rgba(143,227,255,.5);border-radius:6px;background:rgba(9,22,36,.94);color:#fff;font:16px/1.2 system-ui,sans-serif';

/** The chat box's parts, so voice can sit in its row (J218). */
export interface ChatBox { readonly box: HTMLElement; readonly form: HTMLFormElement }
/** E7.6 (Q88): room chat, with a report on every line someone else said. The input takes a phone's own keyboard, at 16 px so iOS doesn't zoom. */
export function chatLines(scope: Scope, client: NetClient, parent: HTMLElement = document.body): ChatBox {
  const box = scope.ownNode(document.createElement('div')), list = document.createElement('div'), form = document.createElement('form'), field = document.createElement('input');
  const style = scope.ownNode(document.createElement('style'));
  style.textContent = CSS; document.head.append(style);
  box.id = 'ws-chat'; list.dataset['lines'] = ''; form.style.cssText = 'display:flex;gap:6px;align-items:center;margin:0';
  field.placeholder = 'Say something'; field.enterKeyHint = 'send'; field.autocomplete = 'off'; field.style.cssText = FIELD;
  form.append(field); box.append(list, form); parent.append(box);
  // What's typed here is chat, not a walk: the game reads its keys further up.
  for (const name of ['keydown', 'keyup', 'keypress']) scope.listen(field, name, event => { event.stopPropagation(); });
  scope.listen(form, 'submit', event => {
    event.preventDefault();
    const text = field.value.trim();
    if (text !== '') client.say('room', text);
    field.value = ''; field.blur();
  });
  const own = (): string | undefined => client.welcome === null ? undefined : String(client.welcome.handle);
  scope.onDispose(client.onChat(({ line, from, name, text }) => {
    const row = document.createElement('div'), words = document.createElement('span');
    row.style.cssText = LINE; row.dataset['line'] = String(line); words.textContent = `${name}: ${text}`;
    row.append(words);
    if (String(from) !== own()) {
      const report = document.createElement('button');
      report.type = 'button'; report.textContent = 'Report'; report.style.cssText = REPORT;
      scope.listen(report, 'click', () => { client.report(line); report.textContent = 'Reported'; report.disabled = true; });
      row.append(report);
    }
    list.append(row);
    while (list.childElementCount > SHOWN) list.firstElementChild?.remove();
  }));
  return { box, form };
}
