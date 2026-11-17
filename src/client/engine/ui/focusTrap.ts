// FM4 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): a card that stops play is aria-modal, so Tab and Shift+Tab go round its own
// controls (its enabled buttons and its Details summary) instead of walking off into the game behind it. InputService leaves Tab
// to an alertdialog (`[role="alertdialog"]`), so this is the only Tab handling such a card gets.
import type { Scope } from '../../../shared/engine/app/scope';

/** Keep Tab inside `root` for as long as `scope` lives. */
export function trapFocus(scope: Scope, root: HTMLElement): void {
  scope.listen(root, 'keydown', event => {
    if (!(event instanceof KeyboardEvent) || event.code !== 'Tab') return;
    const all = [...root.querySelectorAll<HTMLElement>('button, summary')].filter(node => !(node instanceof HTMLButtonElement && node.disabled));
    const first = all[0], last = all.at(-1), at = document.activeElement;
    if (first === undefined || last === undefined) { event.preventDefault(); return; }
    const inside = at instanceof HTMLElement && all.includes(at);
    if (event.shiftKey && (at === first || !inside)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (at === last || !inside)) { event.preventDefault(); first.focus(); }
  });
}
