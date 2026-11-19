/**
 * ZONE-ENTRY ZE8 (J352): the gate card. Feet in a walled cell's buffer show it: the shard's name, "Preparing to enter" and the
 * count (`GateCount`), a crisp DOM card in Shard Select's card style, never G578's blurry canvas panel. A cell the device can't
 * enter shows its reason in place of the count (ZE14). No button: standing there is the yes.
 *
 * QA 11-19 row 53 (Jake, 16:12 Cancún: "it needs to float like a fixed distance away from your face, no matter which way you're
 * looking ... when you walk up to the wall, you can no longer see it"): the card is locked to the camera for the whole count, a
 * screen overlay at one place above the crosshair (gateCard.css), no longer pinned to the gate's face through the camera, which
 * left the view (and hid the card) face-first against the hex wall or looking away from the gate.
 */
import type { Scope } from '@wildshard/engine/app/scope';
import { GAME_STRINGS } from '../../../shared/game/strings';
import './gateCard.css';

export interface GateCardView {
  readonly name: string;
  readonly count: number;
  /** why the cell can't be entered from here, shown in place of the count */
  readonly reason?: string | null;
}

export class GateCard {
  readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly count: HTMLElement;
  private readonly line: HTMLElement;
  private shown: string | null = null;

  constructor(scope: Scope, parent: HTMLElement = document.body) {
    const root = this.root = document.createElement('div');
    root.className = 'ws-gate-card'; root.hidden = true; root.setAttribute('role', 'status');
    this.name = document.createElement('div'); this.name.className = 'ws-gate-name';
    const line = this.line = document.createElement('div'); line.className = 'ws-gate-line'; line.textContent = GAME_STRINGS.grid.gatePreparing;
    this.count = document.createElement('div'); this.count.className = 'ws-gate-count';
    root.append(this.name, line, this.count); parent.append(root);
    scope.onDispose(() => { root.remove(); });
  }

  /** Show the card for the gate the feet are in, wherever the camera looks, or hide it with `null`. */
  show(view: GateCardView | null): void {
    if (view === null) { this.hide(); return; }
    const key = `${view.name}|${String(view.count)}|${view.reason ?? ''}`;
    if (key !== this.shown) {
      this.shown = key; this.name.textContent = view.name;
      this.count.textContent = view.reason ?? String(Math.max(1, view.count));
      // a cell it can't enter isn't being prepared: its reason stands alone under the name
      const reason = view.reason !== undefined && view.reason !== null;
      this.line.hidden = reason; this.count.classList.toggle('ws-gate-reason', reason);
    }
    if (this.root.hidden !== false) this.root.hidden = false;
  }

  hide(): void { if (this.root.hidden !== true) this.root.hidden = true; this.shown = null; }
  /** the card's text while shown (proofs read it) */
  get text(): string | null { return this.root.hidden === true ? null : `${this.name.textContent ?? ''} ${this.count.textContent ?? ''}`; }
}
