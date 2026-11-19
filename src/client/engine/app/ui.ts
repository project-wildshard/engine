import type { Scope } from '../../../shared/engine/app/scope';
import type { InputService } from '../input/InputService';
import { UiLayers, uiInputContext } from '../ui/layers';
import { hudSlots } from '../ui/hudSlots';

/** Displayed UI state follows the active resident level. */
export class AppUi extends UiLayers {
  readonly hud: typeof hudSlots = hudSlots;
  private inputConnected = false;
  private readonly prompts = new WeakMap<Scope, () => string>();
  private readonly active: () => Scope | null;
  constructor(active: () => Scope | null, now: () => number = () => 0) { super(now, true); this.active = active; this.connect(() => { /* Input attaches at boot. */ }, active); }
  connectInput(input: InputService, scope: Scope): void {
    if (this.inputConnected) { this.refresh(); return; }
    this.inputConnected = true;
    let held: '' | 'dialog' | 'menu' = '';
    this.connect(() => {
      if (!input.hasContext('menu')) return;
      const want = uiInputContext(this.blocking, this.menuOpen, input.hasContext('dialog'));
      if (want === held) return;
      if (held !== '') input.pop(held);
      if (want !== '' && !input.contexts.includes(want)) input.push(want, scope);
      held = want;
    }, this.active);
    input.bind('back', () => { this.back(); }, scope, () => this.blocking);
    this.refresh();
  }
  bind(scope: Scope, prompt: () => string): void {
    this.prompts.set(scope, prompt);
    scope.onDispose(() => { this.prompts.delete(scope); });
  }
  prompt(): string {
    const scope = this.active();
    return scope === null ? '' : this.prompts.get(scope)?.() ?? '';
  }
}
