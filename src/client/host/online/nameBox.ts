import type { Scope } from '@wildshard/engine/app/scope';
import { MAX_NAME_LENGTH } from '@wildshard/engine/net/identity';

const STYLE = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;padding:24px;font:600 16px/1.4 system-ui,sans-serif;color:#fff;background:rgba(5,10,18,.86)';
const FIELD = 'width:min(80vw,280px);padding:12px;border:1px solid #8fe3ff;border-radius:8px;background:#091624;color:#fff;font:inherit;text-align:center';
const GO = 'min-height:44px;padding:8px 24px;border:1px solid #8fe3ff;border-radius:8px;background:#0e2438;color:#8fe3ff;font:inherit';

/** E7.6 (Q89): the Name a player goes by. It's asked before the first join and kept with the device id, and logins come after two phones. */
export function askName(scope: Scope, parent: HTMLElement = document.body): Promise<string> {
  const box = scope.ownNode(document.createElement('form')), words = document.createElement('label'), field = document.createElement('input'), go = document.createElement('button');
  box.id = 'ws-name-box'; box.style.cssText = STYLE;
  words.textContent = 'What should others call you?';
  field.maxLength = MAX_NAME_LENGTH; field.autocomplete = 'off'; field.enterKeyHint = 'go'; field.style.cssText = FIELD; field.required = true;
  go.type = 'submit'; go.textContent = 'Enter the world'; go.style.cssText = GO;
  box.append(words, field, go); parent.append(box);
  field.focus();
  return new Promise(resolve => {
    scope.listen(box, 'submit', event => { event.preventDefault(); const name = field.value.trim(); if (name !== '') { box.remove(); resolve(name); } });
  });
}
