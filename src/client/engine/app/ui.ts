import type { Scope } from '../../../shared/engine/app/scope';
import type { InputService } from '../input/InputService';
import { UiLayers } from '../ui/layers';
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
    let menu = false;
    this.connect(() => {
      if (!input.hasContext('menu')) return;
      if (this.blocking && !menu) { if (!input.contexts.includes('menu')) input.push('menu', scope); menu = true; }
      else if (!this.blocking && menu) { input.pop('menu'); menu = false; }
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
