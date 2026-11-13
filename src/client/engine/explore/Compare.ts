import { capturePointer, listenDom } from '../input/dom';
import { app } from '../app/runtime';
import { LoadProgress } from '../ui/loadProgress';
import { engineString } from '../../../shared/engine/strings';
/**
 * World Explorer's static image comparison. Each target has a capture from the same authored
 * camera. Opening it never flies or moves the live camera. Images are requested only when
 * the picker opens and a pair is selected.
 */
import type { World } from '../core/bootstrap';
import type { Explore } from './Explore';

interface Target { id: string; name: string; live: string; target: string; file: string }

export function hasCompareTargets(world: World): boolean { return (world.game.level.explore?.compare ?? []).length > 0; }

const html = (tag: string, cls: string, inner = ''): HTMLElement => { const e = document.createElement(tag); e.className = cls; e.innerHTML = inner; return e; };

export class Compare {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  readonly button: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly liveImg: HTMLImageElement;
  private readonly targetImg: HTMLImageElement;
  private readonly divider: HTMLElement;
  private readonly targets: readonly Target[];
  private readonly pickerProgress: LoadProgress;
  private readonly imageProgress: LoadProgress;
  private split = 0.5;
  private current: Target | null = null;

  private readonly explore: Explore;
  constructor(explore: Explore, world: World) {
    this.explore = explore;
    this.targets = world.game.level.explore?.compare?.map((t) => ({ id: t.id, name: t.label, live: t.live, target: t.image, file: t.target })) ?? [];
    this.button = html('button', 'ws-x-comparebtn', '<svg viewBox="0 0 24 24"><path d="M12 3v18 M4 5h6v14H4z M14 5h6v14h-6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><span>Compare</span>');
    (this.button as HTMLButtonElement).type = 'button';
    this.picker = html('div', 'ws-x-picker', '<div class="ws-x-picker-head"><b>Compare with the mockup</b><button type="button" class="ws-x-picker-close" aria-label="Close">✕</button></div><div class="ws-x-picker-grid"></div>');
    const grid = this.picker.querySelector('.ws-x-picker-grid');
    if (grid === null) throw new Error('Compare: missing picker grid');
    for (const target of this.targets) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ws-x-target'; button.dataset['id'] = target.id;
      const image = document.createElement('span'); image.className = 'ws-x-target-img';
      const label = document.createElement('b'); label.textContent = target.name; button.append(image, label); grid.append(button);
    }
    this.overlay = html('div', 'ws-x-compare', `
      <img class="ws-x-compare-live" alt="In-engine capture" draggable="false">
      <img class="ws-x-compare-target" alt="Target mockup" draggable="false">
      <div class="ws-x-divider" role="slider" tabindex="0" aria-label="Image comparison split" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><i></i></div>
      <div class="ws-x-compare-head"><b></b><button type="button" class="ws-x-compare-close" aria-label="Close comparison">✕</button></div>
      <span class="ws-x-side ws-x-side-l">In engine</span><span class="ws-x-side ws-x-side-r">Mockup</span>`);
    this.liveImg = this.overlay.querySelector<HTMLImageElement>('.ws-x-compare-live') ?? document.createElement('img');
    this.targetImg = this.overlay.querySelector<HTMLImageElement>('.ws-x-compare-target') ?? document.createElement('img');
    this.divider = this.overlay.querySelector<HTMLElement>('.ws-x-divider') ?? this.overlay;
    this.pickerProgress = new LoadProgress(this.picker);
    this.imageProgress = new LoadProgress(this.overlay);
    this.uiScope.onDispose(() => { this.pickerProgress.dispose(); this.imageProgress.dispose(); });
    listenDom(this.uiScope, this.button, 'click', () => { this.togglePicker(); });
    listenDom(this.uiScope, this.picker.querySelector('.ws-x-picker-close'), 'click', () => { this.picker.classList.remove('show'); this.pickerProgress.clear(); });
    this.picker.querySelectorAll<HTMLElement>('.ws-x-target').forEach((b) => { listenDom(this.uiScope, b, 'click', () => { const t = this.targets.find((x) => x.id === b.dataset['id']); if (t) this.show(t); }); });
    listenDom(this.uiScope, this.overlay.querySelector('.ws-x-compare-close'), 'click', () => { this.close(); });
    listenDom(this.uiScope, this.divider, 'pointerdown', (e) => { capturePointer(this.divider, e.pointerId); this.splitAt(e.clientX); e.preventDefault(); });
    listenDom(this.uiScope, this.divider, 'pointermove', (e) => { if (this.divider.hasPointerCapture(e.pointerId)) this.splitAt(e.clientX); });
    listenDom(this.uiScope, this.divider, 'keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      this.split = Math.min(0.98, Math.max(0.02, this.split + (e.key === 'ArrowLeft' ? -0.05 : 0.05)));
      this.apply(); e.preventDefault();
    });
    explore.root.append(this.button, this.picker, this.overlay);
  }

  get isOpen(): boolean { return this.overlay.classList.contains('show'); }

  private togglePicker(): void {
    if (!this.picker.classList.contains('show')) {
      const pending: Promise<void>[] = [];
      this.picker.querySelectorAll<HTMLElement>('.ws-x-target').forEach((b) => {
        const t = this.targets.find((x) => x.id === b.dataset['id']);
        const slot = b.querySelector<HTMLElement>('.ws-x-target-img');
        if (t && slot) {
          const image = new Image(); image.alt = t.name; image.src = t.target;
          slot.replaceChildren(image); pending.push(image.decode());
        }
      });
      void this.pickerProgress.watch(engineString('s_explore_compare'), pending).catch(() => undefined); // Visible failure replaces the spinner.
    } else this.pickerProgress.clear();
    this.picker.classList.toggle('show');
  }

  private show(t: Target): void {
    this.current = t;
    this.picker.classList.remove('show');
    this.pickerProgress.clear();
    this.liveImg.src = t.live;
    this.targetImg.src = t.target;
    void this.imageProgress.watch(t.name, [this.liveImg.decode(), this.targetImg.decode()]).catch(() => undefined);
    const name = this.overlay.querySelector('.ws-x-compare-head b');
    if (name) name.textContent = t.name;
    this.overlay.classList.add('show');
    this.explore.setCompareOpen(true);
    this.apply();
  }

  close(): void {
    this.pickerProgress.clear(); this.imageProgress.clear();
    this.overlay.classList.remove('show'); this.picker.classList.remove('show'); this.current = null;
    this.explore.setCompareOpen(false);
    this.liveImg.removeAttribute('src'); this.targetImg.removeAttribute('src');
  }

  private splitAt(clientX: number): void {
    const bounds = this.overlay.getBoundingClientRect();
    this.split = Math.min(0.98, Math.max(0.02, (clientX - bounds.left) / bounds.width));
    this.apply();
  }

  private apply(): void {
    const pct = `${(this.split * 100).toFixed(2)}%`;
    this.targetImg.style.clipPath = `inset(0 0 0 ${pct})`;
    this.divider.style.left = pct;
    this.divider.setAttribute('aria-valuenow', String(Math.round(this.split * 100)));
  }

  context(): Record<string, string> { return this.current ? { compare: this.current.id, mockup: this.current.file } : {}; }
}
