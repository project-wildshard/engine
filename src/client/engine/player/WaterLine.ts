import { uiScope, mountUi } from '../ui/ownership';
import { engineString } from '../../../shared/engine/strings';
/**
 * WaterLine — the cheap water-line effect for swimming: a DOM gradient (no render pass) that tints the bottom of the
 * view as the eye nears the surface, and the UNDERWATER LOOK once it dips under: a teal-blue wash that deepens with
 * depth, a soft vignette and a slow caustic shimmer (two drifting repeating-radial gradients, screen-blended — CSS
 * animation only, no per-frame JS). The scene-side half (dense blue-green fog) lives in Atmosphere.ts (`setUnderwater`).
 *
 *   const line = new WaterLine();           // Player constructs it; the div sits under #hud so the HUD stays crisp
 *   line.update(eyeAboveSurface, dt);       // metres; +Infinity on dry land. Every frame from Player.update()
 *   line.setHint(0 | 1 | 2);               // desktop key hint: none / "SPACE dive" / "SPACE dive · SHIFT surface" (hidden on touch)
 */
const FADE_FROM = 0.45; // m above the surface where the tint starts …
const FADE_TO = 0.12;   // … and where it is fully on
const DEEP_AT = 6;      // m of eye depth at which the dark layer is fully on

const CSS = `
.ws-waterline { position: fixed; inset: 0; pointer-events: none; opacity: 0; will-change: opacity; overflow: hidden; }
.ws-waterline > i { position: absolute; inset: 0; display: block; opacity: 0; transition: opacity 0.35s; }
.ws-waterline .caustic { inset: -25%; mix-blend-mode: screen; will-change: background-position;
  background:
    radial-gradient(ellipse 42% 30% at 50% 50%, rgba(190, 250, 255, 0.55) 0%, rgba(190, 250, 255, 0) 70%),
    radial-gradient(ellipse 30% 45% at 20% 70%, rgba(170, 240, 255, 0.45) 0%, rgba(170, 240, 255, 0) 70%);
  background-size: 340px 260px, 420px 300px;
  animation: ws-caustic-a 13s ease-in-out infinite alternate; }
.ws-waterline .caustic2 { inset: -25%; mix-blend-mode: screen; will-change: background-position;
  background:
    radial-gradient(ellipse 36% 26% at 65% 35%, rgba(200, 255, 255, 0.5) 0%, rgba(200, 255, 255, 0) 70%),
    radial-gradient(ellipse 26% 40% at 30% 60%, rgba(160, 235, 255, 0.4) 0%, rgba(160, 235, 255, 0) 70%);
  background-size: 520px 380px, 300px 420px;
  animation: ws-caustic-b 19s ease-in-out infinite alternate; }
.ws-waterline .vignette { background: radial-gradient(ellipse at 50% 50%, rgba(2, 18, 28, 0) 48%, rgba(2, 18, 28, 0.42) 100%); }
.ws-waterline .deep { background: rgba(4, 36, 58, 1); transition: opacity 0.6s; }
.ws-waterline.under .caustic { opacity: 0.17; } .ws-waterline.under .caustic2 { opacity: 0.14; } .ws-waterline.under .vignette { opacity: 1; }
@keyframes ws-caustic-a { from { background-position: 0 0, 0 0; } to { background-position: 180px 90px, -120px 150px; } }
@keyframes ws-caustic-b { from { background-position: 0 0, 0 0; } to { background-position: -220px 120px, 140px -160px; } }
.ws-dive-hint { position: absolute; left: 50%; bottom: 160px; transform: translateX(-50%); padding: 7px 14px; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ws-text, #e6f2f8); opacity: 0; transition: opacity 0.2s; white-space: nowrap; }
.ws-dive-hint.show { opacity: 1; }
.ws-dive-hint b { color: var(--ws-cyan, #8fe3ff); font-weight: 500; border: 1px solid var(--ws-cyan-line, rgba(143, 227, 255, 0.35)); padding: 1px 6px; margin-right: 8px; }
.ws-dive-hint b + b { margin-left: 14px; }
#hud.touch .ws-dive-hint, #hud.intro .ws-dive-hint { display: none; }
`;
const ABOVE = 'linear-gradient(180deg, rgba(20,90,110,0) 42%, rgba(24,110,130,0.22) 62%, rgba(18,80,100,0.5) 100%)';
const UNDER = 'linear-gradient(180deg, rgba(40,170,190,0.18) 0%, rgba(18,120,150,0.24) 55%, rgba(8,70,100,0.34) 100%)';
const HINTS = ['', '<b>Space</b>Dive', '<b>Space</b>Dive <b>Shift</b>Surface'] as const;

/** what the player drives: the eye's height over the surface each frame, and the dive hint */
export interface WaterLineView { update: (eyeAboveSurface: number, dt: number) => void; setHint: (state: 0 | 1 | 2) => void }

export class WaterLine implements WaterLineView {
  readonly scope: ReturnType<typeof uiScope> = uiScope('waterLine');
  private el: HTMLDivElement;
  private deep: HTMLElement;
  private hint?: HTMLElement;
  private lastA = -1; private lastUnder = false; private lastDeep = -1; private lastHint = 0;

  constructor() {
    if (!document.getElementById('ws-waterline-css')) {
      const st = document.createElement('style'); st.id = 'ws-waterline-css'; st.textContent = CSS; document.head.append(st);
    }
    const el = this.el = document.createElement('div');
    el.className = 'ws-waterline';
    el.style.background = ABOVE;
    el.innerHTML = engineString('s_8a0384e5d38d');
    const deep = el.querySelector<HTMLElement>('.deep');
    if (deep === null) throw new Error('WaterLine: .deep layer missing');
    this.deep = deep;
    const hud = document.getElementById('hud');
    mountUi(el, this.scope, document.body, hud);
    if (hud) { const h = this.hint = document.createElement('div'); h.className = 'ws-glass ws-dive-hint'; mountUi(h, this.scope, hud); }
  }

  update(eyeAbove: number, _dt = 0): void {
    const under = eyeAbove < 0;
    if (under !== this.lastUnder) {
      this.lastUnder = under;
      this.el.style.background = under ? UNDER : ABOVE;
      this.el.classList.toggle('under', under);
    }
    const a = under ? 1 : eyeAbove >= FADE_FROM ? 0 : Math.min(1, (FADE_FROM - eyeAbove) / (FADE_FROM - FADE_TO));
    if (Math.abs(a - this.lastA) > 0.01) { this.lastA = a; this.el.style.opacity = a.toFixed(2); }
    // the deeper the eye, the darker the wash (the surface light fades; the fog does the rest in-scene)
    const d = under ? Math.min(0.18, (-eyeAbove / DEEP_AT) * 0.18) : 0;
    if (Math.abs(d - this.lastDeep) > 0.01) { this.lastDeep = d; this.deep.style.opacity = d.toFixed(2); }
  }

  /** desktop key hint under the crosshair: 0 none, 1 at the surface (dive), 2 submerged (dive · surface) */
  setHint(mode: 0 | 1 | 2): void {
    if (mode === this.lastHint || !this.hint) return;
    this.lastHint = mode;
    if (mode) this.hint.innerHTML = HINTS[mode];
    this.hint.classList.toggle('show', mode !== 0);
  }
}
