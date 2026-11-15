/**
 * ZONE-ENTRY ZE8 (J352): the gate card. Feet in a walled cell's buffer show it on that buffer's gate: the shard's name, "Preparing
 * to enter" and the count (`GateCount`). It is a crisp DOM card in Shard Select's card style, pinned each frame to the gate's face
 * through the camera and scaled with distance, so it reads as standing in the world (board pick A), never G578's blurry canvas
 * panel. A cell the device can't enter shows its reason in place of the count (ZE14). No button: standing there is the yes.
 */
import { Vector3, type Camera } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { GAME_STRINGS } from '../../../shared/game/strings';
import { BUFFER_DEPTH } from '../../../shared/game/grid/zoneWalls';
import './gateCard.css';

/** The card's height on the gate (metres above the road) and the distance it is drawn at its full size. */
const LIFT = 2.6, FULL_AT = 9;

export interface GateCardView {
  /** the gate's cell centre in the render frame, and the feet there: the gate faced is the side nearest the feet */
  readonly centre: { readonly x: number; readonly z: number };
  readonly feet: { readonly x: number; readonly z: number };
  readonly name: string;
  readonly count: number;
  /** why the cell can't be entered from here, shown in place of the count */
  readonly reason?: string | null;
}

export class GateCard {
  readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly count: HTMLElement;
  private readonly at = new Vector3();
  private shown: string | null = null;

  constructor(scope: Scope, parent: HTMLElement = document.body) {
    const root = this.root = document.createElement('div');
    root.className = 'ws-gate-card'; root.hidden = true; root.setAttribute('role', 'status');
    this.name = document.createElement('div'); this.name.className = 'ws-gate-name';
    const line = document.createElement('div'); line.className = 'ws-gate-line'; line.textContent = GAME_STRINGS.grid.gatePreparing;
    this.count = document.createElement('div'); this.count.className = 'ws-gate-count';
    root.append(this.name, line, this.count); parent.append(root);
    scope.onDispose(() => { root.remove(); });
  }

  /** Pin the card to its gate, or hide it with `null`. */
  show(view: GateCardView | null, camera: Camera | undefined, width: number, height: number): void {
    if (view === null || camera === undefined) { this.hide(); return; }
    const dx = view.feet.x - view.centre.x, dz = view.feet.z - view.centre.z, alongX = Math.abs(dx) >= Math.abs(dz);
    const face = CHUNK_HALF - BUFFER_DEPTH - 0.3;
    this.at.set(view.centre.x + (alongX ? Math.sign(dx) * face : 0), LIFT, view.centre.z + (alongX ? 0 : Math.sign(dz) * face));
    const distance = Math.max(0.5, this.at.distanceTo(camera.position));
    this.at.project(camera);
    if (this.at.z > 1 || Math.abs(this.at.x) > 1.4 || Math.abs(this.at.y) > 1.4) { this.hide(); return; }
    const key = `${view.name}|${String(view.count)}|${view.reason ?? ''}`;
    if (key !== this.shown) {
      this.shown = key; this.name.textContent = view.name;
      this.count.textContent = view.reason ?? String(Math.max(1, view.count));
    }
    const scale = Math.min(1.2, Math.max(0.45, FULL_AT / distance));
    const x = (this.at.x * 0.5 + 0.5) * width, y = (-this.at.y * 0.5 + 0.5) * height;
    this.root.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    this.root.hidden = false;
  }

  hide(): void { if (this.root.hidden !== true) this.root.hidden = true; this.shown = null; }
  /** the card's text while shown (proofs read it) */
  get text(): string | null { return this.root.hidden === true ? null : `${this.name.textContent ?? ''} ${this.count.textContent ?? ''}`; }
}
