import type { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';

/** Lines kept on screen. Room chat is for a sitting of two (Q88), so a long history would only cover the world. */
const SHOWN = 6;
const STYLE = 'position:fixed;left:8px;top:calc(env(safe-area-inset-top,0px) + 92px);z-index:900;width:min(56vw,260px);display:flex;flex-direction:column;gap:4px;font:500 13px/1.3 system-ui,sans-serif;color:#fff;pointer-events:none';
const LINE = 'display:flex;gap:6px;align-items:baseline;padding:2px 6px;border-radius:6px;background:rgba(8,14,24,.56);pointer-events:auto;overflow-wrap:anywhere';
const REPORT = 'flex:none;margin-left:auto;padding:0 6px;border:0;background:none;color:#8fe3ff;font:inherit;font-size:11px';
const FIELD = 'pointer-events:auto;flex:1;min-width:0;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid rgba(143,227,255,.5);border-radius:6px;background:rgba(9,22,36,.8);color:#fff;font:16px/1.2 system-ui,sans-serif';

/** The chat box's parts, so voice can sit in its row (J218). */
export interface ChatBox { readonly box: HTMLElement; readonly form: HTMLFormElement }
/** E7.6 (Q88): room chat, with a report on every line someone else said. The input takes a phone's own keyboard, at 16 px so iOS doesn't zoom. */
export function chatLines(scope: Scope, client: NetClient, parent: HTMLElement = document.body): ChatBox {
  const box = scope.ownNode(document.createElement('div')), list = document.createElement('div'), form = document.createElement('form'), field = document.createElement('input');
  box.id = 'ws-chat'; box.style.cssText = STYLE; list.style.cssText = 'display:flex;flex-direction:column;gap:4px'; form.style.cssText = 'display:flex;gap:6px;align-items:center;margin:0';
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
