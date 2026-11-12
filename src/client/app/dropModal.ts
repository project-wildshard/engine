// The drop modal (Jake, 2026-11-12: "where's the fucking error modal? … maybe it's like unexpectedly back at the main menu modal").
// The title shows it when the page got here without the player asking: a load that failed, a refusal, a crash or reload
// (src/client/engine/boot/dropNotice.ts says which). Plain words for everyone; with Developer on, the real error too: the message,
// the code or close reason, the stack and the step it failed at. COPY DETAILS and DISMISS. It wears the error modal's glass
// (src/client/engine/ui/ErrorModal.ts) with its own styles, so it never waits on a stylesheet or the renderer.
import type { Scope } from '@wildshard/engine/app/scope';
import type { Drop } from '@wildshard/engine/boot/dropNotice';
import { mountUi } from '@wildshard/engine/ui/ownership';

const STYLE = `
  #wsdrop { position: fixed; inset: 0; z-index: var(--ws-layer-error, 2147482500); display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); background: rgba(4, 9, 14, 0.62); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); color: #e6f2f8; font: 12px/1.5 "JetBrains Mono", ui-monospace, Menlo, monospace; }
  #wsdrop .box { position: relative; box-sizing: border-box; width: min(440px, 100%); max-height: 100%; overflow: auto; padding: 22px 18px 16px; background: rgba(13, 27, 38, 0.9); border: 1px solid rgba(143, 227, 255, 0.35); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55); }
  #wsdrop .tag { margin: 0 0 10px; font-size: 10px; letter-spacing: 0.32em; text-transform: uppercase; color: #8fe3ff; }
  #wsdrop .tag::before { content: ''; display: inline-block; width: 6px; height: 6px; margin: 0 10px 1px 0; background: #ffb86b; box-shadow: 0 0 8px #ffb86b; vertical-align: middle; }
  #wsdrop h1 { margin: 0 0 10px; font: 700 21px/1.2 Rajdhani, "JetBrains Mono", sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; overflow-wrap: anywhere; }
  #wsdrop .reason { margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: #ffb86b; overflow-wrap: anywhere; }
  #wsdrop .dev { margin: 0 0 14px; padding: 10px; border: 1px solid rgba(255, 184, 107, 0.35); background: rgba(4, 9, 14, 0.7); }
  #wsdrop .dev b { display: block; margin-bottom: 6px; font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase; color: #ffb86b; font-weight: 400; }
  #wsdrop .dev dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; margin: 0 0 8px; }
  #wsdrop .dev dt { color: rgba(143, 227, 255, 0.7); }
  #wsdrop .dev dd { margin: 0; color: #fff; overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; }
  #wsdrop pre { margin: 0; padding: 8px; max-height: 28vh; overflow: auto; background: rgba(4, 9, 14, 0.7); border: 1px solid rgba(143, 227, 255, 0.14); color: #b9c4d3; white-space: pre-wrap; word-break: break-word; font-size: 10.5px; -webkit-user-select: text; user-select: text; }
  #wsdrop .row { display: flex; gap: 8px; }
  #wsdrop button { appearance: none; -webkit-appearance: none; flex: 1 1 0; min-height: 48px; padding: 12px 14px; cursor: pointer; font: 700 11px/1 "JetBrains Mono", monospace; letter-spacing: 0.22em; text-transform: uppercase; border: 1px solid rgba(143, 227, 255, 0.35); background: rgba(143, 227, 255, 0.06); color: #8fe3ff; touch-action: manipulation; }
  #wsdrop button.go { border-color: #8fe3ff; background: rgba(143, 227, 255, 0.18); color: #fff; }
`;

/** every fact about the drop, as COPY DETAILS puts it on the clipboard */
export function dropDetails(drop: Drop, extra: readonly string[] = []): string {
  return [
    drop.what, drop.reason,
    drop.step === '' ? '' : `Step: ${drop.step}`,
    drop.message === '' ? '' : `Error: ${drop.message}`,
    drop.code === '' ? '' : `Code: ${drop.code}`,
    drop.end === '' ? '' : `Previous page: ${drop.end}`,
    `World: ${drop.name || drop.world || 'none'} · build ${drop.build || 'unknown'} · ${drop.at > 0 ? new Date(drop.at).toISOString() : 'time unknown'}`,
    ...extra,
    drop.stack === '' ? '' : `\n${drop.stack}`,
  ].filter((line) => line !== '').join('\n');
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className !== '') el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

/** Show the drop over the title. `dev`: the real error too. Returns the close. */
export function showDropModal(drop: Drop, scope: Scope, options: { readonly dev: boolean; readonly extra?: readonly string[]; readonly parent?: HTMLElement }): () => void {
  if (document.getElementById('wsdrop-style') === null) {
    const style = make('style', ''); style.id = 'wsdrop-style'; style.textContent = STYLE; document.head.append(style);
  }
  document.getElementById('wsdrop')?.remove();
  const root = make('div', ''); root.id = 'wsdrop';
  root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', drop.what);
  root.dataset['kind'] = drop.kind;
  const box = make('div', 'box');
  box.append(make('p', 'tag', drop.kind === 'restart' ? 'Restarted' : 'Back at the title'), make('h1', '', drop.what), make('p', 'reason', drop.reason));
  if (options.dev) {
    const dev = make('div', 'dev'); dev.append(make('b', '', 'Developer details'));
    const list = make('dl', '');
    const add = (label: string, value: string): void => { if (value !== '') list.append(make('dt', '', label), make('dd', '', value)); };
    add('Step', drop.step || 'none recorded');
    add('Error', drop.message || 'none caught');
    add('Code', drop.code);
    add('World', drop.name || drop.world);
    add('Previous page', drop.end);
    add('Build', drop.build);
    for (const line of options.extra ?? []) add('Note', line);
    dev.append(list);
    if (drop.stack !== '') dev.append(make('pre', 'stack', drop.stack));
    box.append(dev);
  }
  const row = make('div', 'row');
  const copy = make('button', 'copy', 'Copy details'); copy.type = 'button';
  const dismiss = make('button', 'go dismiss', 'Dismiss'); dismiss.type = 'button';
  row.append(copy, dismiss); box.append(row); root.append(box);
  const close = (): void => { root.remove(); };
  const clip: { clipboard?: Clipboard | undefined } = navigator;
  scope.listen(copy, 'click', () => {
    const text = dropDetails(drop, options.extra);
    void (async () => {
      try { if (clip.clipboard === undefined) throw new Error('no clipboard'); await clip.clipboard.writeText(text); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy failed'; }
    })();
  });
  scope.listen(dismiss, 'click', close);
  scope.onDispose(close);
  mountUi(root, scope, options.parent);
  dismiss.focus({ preventScroll: true });
  return close;
}
