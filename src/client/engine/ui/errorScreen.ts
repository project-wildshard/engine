import { markReload } from '../boot/lastEnd';
import { engineString } from '../../../shared/engine/strings';
import type { LoadFailure } from '../core/errorReport';
import { app } from '../app/runtime';
import { uiScope, mountUi } from './ownership';
import { listenTap } from '../input/dom';
import { copyText, diagnosticsSource } from './diagnosticsCopy';

const scope = uiScope('loadFailure', app.engineScope);

/** The shell survives the disposed level. Text nodes keep raw error messages/stacks safe to display. */
export function showLoadFailure(failure: LoadFailure): HTMLElement {
  {
    document.querySelector('.ws-load-error')?.remove();
    const root = document.createElement('section');
    root.className = 'ws-load-error';
    root.dataset['wsShell'] = 'true';
    root.setAttribute('role', 'alert');
    root.style.cssText = 'position:fixed;inset:0;z-index:calc(var(--ws-layer-error,2147482500) + 1147);box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));background:#0d1b26;color:#e8f5fa;font:16px/1.5 monospace;overflow:auto';
    const heading = document.createElement('h1');
    heading.textContent = engineString('s_114476f37bae', [failure.name]);
    const context = document.createElement('p');
    context.textContent = engineString('s_ac1d8f02f8f2', [failure.build, failure.stage]);
    const message = document.createElement('p');
    message.textContent = failure.message;
    const stack = document.createElement('pre');
    stack.style.cssText = 'flex:1;min-height:100px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #8fe3ff;padding:16px;font:13px/1.5 monospace';
    stack.textContent = failure.stack;
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = engineString('s_8229c4ee6826');
    const button = 'flex:none;min-height:52px;padding:14px 28px;border:1px solid #8fe3ff;color:#e8f5fa;background:#0d1b26;font:inherit;text-transform:uppercase;cursor:pointer;touch-action:manipulation';
    reload.style.cssText = button;
    scope.listen(reload, 'click', () => { markReload('load failure reload'); location.reload(); });
    // LS4 (J188): this screen covers the loading card, so Copy diagnostics moves here, beside Reload, in flow after the
    // stack: the failure stays on screen and the one Copy stays tappable. The report is the card's own.
    const actions = document.createElement('div');
    actions.style.cssText = 'flex:none;display:flex;flex-wrap:wrap;gap:12px';
    actions.append(reload);
    const read = diagnosticsSource();
    if (read !== null) {
      for (const covered of document.querySelectorAll('.ws-load .ws-load-copy')) covered.remove();
      const copy = document.createElement('button');
      copy.type = 'button'; copy.className = 'ws-load-copy'; copy.textContent = engineString('s_loading_copy');
      copy.style.cssText = button;
      listenTap(scope, copy, () => {
        void copyText(read()).then(ok => { copy.textContent = engineString(ok ? 's_loading_copied' : 's_loading_copy_failed'); return undefined; });
      });
      actions.append(copy);
    }
    root.append(heading, context, message, stack, actions);
    mountUi(root, scope, document.body);
    app.ui.push('error', { root, order: 1147, back: () => { /* Fatal load failure requires reload. */ } }, scope);
    reload.focus();
    return root;
  }
}
