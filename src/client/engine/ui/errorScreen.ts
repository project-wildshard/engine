import { markReload } from '../boot/lastEnd';
import { engineString } from '../../../shared/engine/strings';
import type { LoadFailure } from '../core/errorReport';
import { app } from '../app/runtime';
import { uiScope, mountUi } from './ownership';

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
    reload.style.cssText = 'align-self:flex-start;padding:14px 28px;border:1px solid #8fe3ff;color:#e8f5fa;background:#0d1b26;font:inherit;cursor:pointer';
    scope.listen(reload, 'click', () => { markReload('load failure reload'); location.reload(); });
    root.append(heading, context, message, stack, reload);
    mountUi(root, scope, document.body);
    app.ui.push('error', { root, order: 1147, back: () => { /* Fatal load failure requires reload. */ } }, scope);
    reload.focus();
    return root;
  }
}
