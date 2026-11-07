import { hudSlots } from '@wildshard/engine/ui/hudSlots';
import { uiScope, mountUi } from '@wildshard/engine/ui/ownership';
/**
 * CoinChip — the purse on the HUD (E314 L1, board 1 A): a small "◉ 23" chip under VITALS in the base HUD's language
 * (navy glass, a cyan hairline, the display numerals), and the "+n" that pops over a kill. It has its own anchored spot,
 * never a row of the status column: VITALS hide at full health (E319) and the chip must not jump or vanish with them. On
 * touch it sits in the touch layer (src/client/engine/ui/hudSlots.ts onLayer) at VITALS' second-row slot, left under PAUSE; with a
 * mouse, over the VITALS panel, bottom-left. Styled by src/client/game/loot/loot.css (prefix ws-loot-). Only built on a shard
 * with coins.
 *
 *   const chip = new CoinChip(purse.coins);
 *   chip.set(n)                  // the total (bumps when it grows)
 *   chip.pop(x, y, n)            // "+n" at a screen point (CSS px), floats up and fades
 *   chip.dispose()
 */
import '../loot.css';

const POPS = 4;
const COIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f2c44d"/><circle cx="12" cy="12" r="6.6" fill="none" stroke="#9c6a12" stroke-width="1.8"/><circle cx="12" cy="12" r="2.2" fill="#9c6a12"/></svg>';

export class CoinChip {
  readonly scope: ReturnType<typeof uiScope> = uiScope('CoinChip');
  readonly root: HTMLElement;
  private num: HTMLElement;
  private pops: HTMLElement[] = [];
  private nextPop = 0;
  private shown = -1;
  private readonly offLayer: () => void;

  constructor(coins: number) {
    this.root = document.createElement('div');
    this.root.className = 'ws-loot-chip';
    this.root.innerHTML = `<i class="ws-loot-coin">${COIN_SVG}</i><b class="ws-loot-num">0</b>`;
    const num = this.root.querySelector<HTMLElement>('.ws-loot-num');
    if (!num) throw new Error('CoinChip: no .ws-loot-num');
    this.num = num;
    const hud = document.getElementById('hud') ?? document.body;
    for (let i = 0; i < POPS; i++) {
      const p = document.createElement('div'); p.className = 'ws-loot-pop';
      mountUi(p, this.scope, hud); this.pops.push(p);
    }
    this.set(coins, false);
    // docked in #hud (a mouse device: over the VITALS panel, bottom-left); when the touch layer mounts it moves into the
    // layer (now, or on mount), anchored under PAUSE at VITALS' second-row slot (loot.css)
    mountUi(this.root, this.scope, hud);
    this.offLayer = hudSlots.onLayer((layer) => { layer.append(this.root); });
  }

  set(coins: number, bump = true): void {
    if (coins === this.shown) return;
    const grew = coins > this.shown && this.shown >= 0;
    this.shown = coins;
    this.num.textContent = String(coins);
    if (bump && grew) { this.root.classList.remove('bump'); void this.root.offsetWidth; this.root.classList.add('bump'); }
  }

  pop(x: number, y: number, n: number): void {
    const p = this.pops[this.nextPop];
    if (!p) return;
    this.nextPop = (this.nextPop + 1) % this.pops.length;
    p.innerHTML = `+${n}<i class="ws-loot-coin">${COIN_SVG}</i>`;
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    p.classList.remove('show'); void p.offsetWidth; p.classList.add('show');
  }

  dispose(): void {
    this.offLayer(); this.scope.dispose(); this.root.remove();
    for (const p of this.pops) p.remove();
  }
}
