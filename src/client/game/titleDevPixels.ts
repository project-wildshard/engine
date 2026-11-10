import { DENSITY_SCALE, devPixelRatio, drawingBuffer, saveDevPixels, savedDevPixels, type DevDensity, type DevPixels, type DevScreen } from '@wildshard/engine/render/devPixels';

/**
 * QA row 25 (Jake, 2026-11-10: "when developer mode is on, allow me to switch between 2x and 1x pixel density. Allow me to switch
 * between 3x screen, 2x screen, 1x screen ... 6 permutations"): a Developer-only card on the shard-select screen (a temporary
 * home, his word). SCREEN is the device-pixel-ratio cap (AUTO = the tier's own, no override); DENSITY the render scale on top
 * (2× = 1, 1× = ¾). Its last line names the drawing buffer the pick gives this screen, and the frame meter's TIER · DPR row
 * shows the same in play. Saved on the device (render/devPixels.ts); the game applies it live.
 */
export function titleDevPixels(onTap: (el: HTMLElement, fn: () => void) => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ws-menu-devpx'; root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Developer pixels');
  const seg = (label: string, help: string, options: readonly (readonly [string, string])[]): { row: HTMLElement; buttons: Map<string, HTMLButtonElement> } => {
    const row = document.createElement('div'); row.className = 'ws-menu-devpx-row';
    const name = document.createElement('i'); name.className = 'ws-menu-devpx-k'; name.textContent = label;
    const group = document.createElement('span'); group.className = 'ws-menu-devpx-seg';
    const buttons = new Map<string, HTMLButtonElement>();
    for (const [key, text] of options) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset['v'] = key; b.textContent = text; group.append(b); buttons.set(key, b);
    }
    const note = document.createElement('small'); note.className = 'ws-menu-devpx-help'; note.textContent = help;
    row.append(name, group, note); return { row, buttons };
  };
  const screen = seg('Screen', 'DPR cap', [['auto', 'Auto'], ['3', '3×'], ['2', '2×'], ['1', '1×']]);
  const density = seg('Density', `scale 2× = ${String(DENSITY_SCALE[2])} · 1× = ¾`, [['2', '2×'], ['1', '1×']]);
  const out = document.createElement('output'); out.className = 'ws-menu-devpx-out';
  root.append(screen.row, density.row, out);

  let pick: DevPixels | null = savedDevPixels(), lastDensity: DevDensity = pick?.density ?? 2;
  const paint = (): void => {
    for (const [key, b] of screen.buttons) b.setAttribute('aria-pressed', String(key === (pick === null ? 'auto' : String(pick.screen))));
    for (const [key, b] of density.buttons) { b.setAttribute('aria-pressed', String(pick !== null && key === String(pick.density))); b.disabled = pick === null; }
    const device = window.devicePixelRatio, ratio = pick === null ? null : devPixelRatio(device, pick);
    if (ratio === null) { out.textContent = `Auto · the tier's cap · screen ${String(device)}×`; return; }
    const buffer = drawingBuffer(window.innerWidth, window.innerHeight, ratio);
    out.textContent = `${ratio.toFixed(2)}× · ${String(buffer.width)}×${String(buffer.height)} · ${(buffer.pixels / 1e6).toFixed(2)} MP`;
  };
  const choose = (next: DevPixels | null): void => { pick = next; if (next !== null) lastDensity = next.density; saveDevPixels(next); paint(); };
  for (const [key, b] of screen.buttons) onTap(b, () => { choose(key === 'auto' ? null : { screen: Number(key) as DevScreen, density: lastDensity }); });
  for (const [key, b] of density.buttons) onTap(b, () => { if (pick !== null) choose({ screen: pick.screen, density: Number(key) as DevDensity }); });
  paint();
  return root;
}
