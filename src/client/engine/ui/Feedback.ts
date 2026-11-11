import { uiScope, mountUi } from './ownership';
import { app } from '../app/runtime';
import type { UiHandle } from './layers';
import { engineString } from '../../../shared/engine/strings';
import { terrainDatum } from '../../../shared/engine/world/terrainHeight';
/**
 * The review inbox's composer (project/archive/2026-09-22-feedback-inbox.md, mockups art/feedback/round-1-inbox/) — loaded lazily on the first
 * F8 / ✎ / System ▸ Feedback, so the boot bundle never carries it. Styled by src/client/engine/ui/styles/feedback.css (prefix ws-fb-).
 *
 *   const fb = new Feedback(host);
 *   await fb.openQuick()        // desktop F8: the frame is captured + frozen, a one-line bar under the crosshair; Tab → the sheet
 *   await fb.openSheet()        // the full sheet: right-docked on desktop, a bottom sheet on touch (the ✎ disc)
 *   await fb.mountTab(panel)    // Settings ▸ System ▸ Feedback (SR13): the same composer inside the menu's panel (the world keeps running)
 *
 * A note = the words + a category chip + a JPEG of the frame (freehand pen strokes baked in) + the repro context
 * (host.context() + build / viewport / tier / the `?at=` URL that puts you back on the spot). Sending goes through
 * src/client/engine/ui/review.ts (offline queue there). Keys typed into the composer never reach the game: the root stops them.
 */
import { CATEGORIES, queuedCount, sendNote, type Category, type ContextValue } from './review';

declare const __BUILD_ID__: string; // vite.config.ts define

export interface FeedbackHost {
  /** a copy of the next rendered frame (Game.captureFrame) */
  capture: () => Promise<HTMLCanvasElement>;
  /** where the player is and what they hold — main.ts */
  context: () => Record<string, ContextValue>;
  /** freeze the world + input under an overlay composer and release it (the menu tab does not use it) */
  hold: (on: boolean) => void;
  toast: (text: string) => void;
  /** the touch layer is up (#hud.touch): bottom sheet, no quick bar */
  touch: () => boolean;
}

type Mode = 'bar' | 'sheet' | 'tab';
interface Stroke { pts: number[] } // normalised x, y pairs (0..1 of the frame)

export const SHOT_MAX_W = 1280;
export const SHOT_MAX_BYTES: number = 300 * 1024;
const PEN_PX = 4; // stroke width at 1280 px wide
const LABEL: Record<Category, string> = { bug: engineString('s_703a5028367b'), art: engineString('s_75df3579c730'), feel: engineString('s_cd1e23876319'), perf: engineString('s_10eda87ca497'), idea: engineString('s_b202bcb90ca5') };

const el = (cls: string, html = '', tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; };
const button = (cls: string, html: string): HTMLButtonElement => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.innerHTML = html; return b; };

/** compass heading as the HUD shows it: +Z is north, `180 − yaw°` (src/client/engine/ui/HUD.ts) */
export function headingDeg(yaw: number): number { const d = 180 - (yaw * 180) / Math.PI; return Math.round(((d % 360) + 360) % 360) % 360; }

/** the URL that reloads the game on this spot: `?chunk=&at=x,y,z,yaw,pitch&weapon=&skipintro` (main.ts reads `at`), or in Explore `?chunk=&explore=&cam=&model=` */
export function reproUrl(origin: string, c: Record<string, ContextValue>): string {
  const q = new URLSearchParams();
  if (typeof c['shard'] === 'string') q.set('chunk', c['shard']);
  // a note filed in Explore World reopens the same view: `?explore=world|model&cam=x,y,z,yaw,pitch&model=id` (main.ts)
  if (typeof c['explore'] === 'string') {
    q.set('explore', c['explore']);
    if (Array.isArray(c['cam'])) q.set('cam', c['cam'].map((v) => Number(v.toFixed(2))).join(','));
    if (typeof c['model'] === 'string') q.set('model', c['model']);
    return engineString('s_ba48ed755795', [origin, q.toString()]);
  }
  const pos = c['pos'], yaw = c['yaw'], pitch = c['pitch'];
  // `at`'s y is in the level's authored frame (less its runtime datum, G164), as every `?at=` writer keeps it
  if (Array.isArray(pos) && typeof yaw === 'number' && typeof pitch === 'number') q.set('at', [...pos.map((v, i) => (i === 1 ? v - terrainDatum() : v)), yaw, pitch].map((v) => Number(v.toFixed(2))).join(','));
  if (typeof c['weapon'] === 'string') q.set('weapon', c['weapon']);
  q.set('skipintro', '');
  return engineString('s_ba48ed755795', [origin, q.toString().replace('skipintro=', 'skipintro')]);
}

/** the frame with the pen strokes drawn on it, as a JPEG data URL under SHOT_MAX_BYTES (quality steps down until it fits) */
export function bake(shot: HTMLCanvasElement, strokes: readonly Stroke[]): string {
  const c = document.createElement('canvas'); c.width = shot.width; c.height = shot.height;
  const g = c.getContext('2d');
  if (!g) return '';
  g.drawImage(shot, 0, 0);
  g.strokeStyle = '#8fe3ff'; g.lineWidth = Math.max(2, (PEN_PX * c.width) / SHOT_MAX_W); g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = 'rgba(0, 0, 0, 0.6)'; g.shadowBlur = 3;
  for (const s of strokes) {
    g.beginPath();
    for (let i = 0; i + 1 < s.pts.length; i += 2) {
      const x = (s.pts[i] ?? 0) * c.width, y = (s.pts[i + 1] ?? 0) * c.height;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (const q of [0.7, 0.55, 0.4]) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length * 0.75 <= SHOT_MAX_BYTES) return url;
  }
  return c.toDataURL('image/jpeg', 0.3);
}

export class Feedback {
  readonly scope: ReturnType<typeof uiScope> = uiScope('Feedback');
  private layer: UiHandle | null = null;
  private viewScope = this.scope.child('view');
  private root: HTMLElement | null = null;
  private mode: Mode | null = null;
  private shot: HTMLCanvasElement | null = null;
  private strokes: Stroke[] = [];
  private category: Category = 'bug';
  private text = '';
  private ctx: Record<string, ContextValue> = {};
  private sending = false;
  private held = false;

  private host: FeedbackHost;
  constructor(host: FeedbackHost) {
    this.host = host;
  }

  get isOpen(): boolean { return this.mode === 'bar' || this.mode === 'sheet'; }

  /** F8: the quick bar (touch goes straight to the sheet) */
  async openQuick(): Promise<void> {
    if (this.host.touch()) { await this.openSheet(); return; }
    if (this.isOpen) return;
    await this.begin();
    this.render('bar');
  }

  /** the ✎ disc / Tab from the bar: the full sheet */
  async openSheet(): Promise<void> {
    if (this.mode === 'sheet') return;
    if (!this.isOpen) await this.begin();
    this.render('sheet');
  }

  /** Settings ▸ System ▸ Feedback (SR13): re-capture the frame (the world runs under the menu) and draw the composer into the panel */
  async mountTab(panel: HTMLElement): Promise<void> {
    if (this.isOpen) this.close();
    this.shot = await this.host.capture();
    this.ctx = this.host.context();
    this.strokes = [];
    this.render('tab', panel);
  }

  close(): void {
    const wasOverlay = this.isOpen;
    this.layer?.dispose(); this.layer = null; this.viewScope.dispose();
    this.root?.remove();
    this.root = null; this.mode = null;
    if (wasOverlay && this.held) { this.held = false; this.host.hold(false); }
  }

  private async begin(): Promise<void> {
    this.shot = await this.host.capture(); // the frame as it was when you pressed — then the world stops
    this.ctx = this.host.context();
    this.strokes = [];
    this.held = true;
    this.host.hold(true);
  }

  // ── rendering ──
  private render(mode: Mode, panel?: HTMLElement): void {
    this.layer?.dispose(); this.layer = null; this.viewScope.dispose(); this.viewScope = this.scope.child('view');
    this.root?.remove();
    this.mode = mode;
    const root = mode === 'tab' ? el('ws-fb-tab') : el(`ws-fb ${mode}${this.host.touch() ? ' phone' : ''}`);
    this.root = root;
    // the composer owns the keyboard: nothing typed here reaches Player / Weapons / HUD (they listen on document)
    // (in the menu tab Esc still goes through, so it closes the menu as everywhere else)
    for (const t of ['keydown', 'keyup'] as const) this.viewScope.listen(root, t, (e) => { if (e.code === 'Escape') return; e.stopPropagation(); if (t === 'keydown') this.onKey(e); });
    if (mode === 'bar') this.buildBar(root);
    else this.buildSheet(root, mode);
    if (panel) panel.replaceChildren(root); else { mountUi(root, this.viewScope, document.body); this.layer = app.ui.push('modal', { root, order: 0, back: () => { this.close(); } }, this.viewScope); }
    const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('.ws-fb-input, .ws-fb-text');
    if (field && mode !== 'tab') { field.focus(); field.setSelectionRange(field.value.length, field.value.length); }
  }

  private onKey(e: KeyboardEvent): void {
    if (this.mode === 'tab') return; // the menu owns Esc there

    if (e.code === 'Tab' && this.mode === 'bar') { e.preventDefault(); void this.openSheet(); return; }
    if (e.code === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(); }
  }

  private chips(): HTMLElement {
    const box = el('ws-fb-chips');
    for (const c of CATEGORIES) {
      const b = button(`ws-fb-chip${c === this.category ? ' on' : ''}`, LABEL[c]);
      this.viewScope.listen(b, 'click', () => { this.category = c; for (const x of box.children) x.classList.toggle('on', x === b); });
      box.append(b);
    }
    return box;
  }

  private buildBar(root: HTMLElement): void {
    root.append(el('ws-fb-dim'));
    const wrap = el('ws-fb-quick');
    wrap.append(el('ws-fb-cap', engineString('s_b88a944b540e')));
    const bar = el('ws-fb-bar');
    bar.append(el('ws-fb-cam', engineString('s_3e64ed0c89f6')));
    const input = document.createElement('input'); input.className = 'ws-fb-input'; input.type = 'text'; input.maxLength = 4000;
    input.placeholder = engineString('s_a3ef944b5384'); input.value = this.text; input.enterKeyHint = 'send';
    this.viewScope.listen(input, 'input', () => { this.text = input.value; });
    bar.append(input, this.chips(), el('ws-fb-keys', engineString('s_66aec2a7867c')));
    wrap.append(bar);
    root.append(wrap);
  }

  private buildSheet(root: HTMLElement, mode: Mode): void {
    if (mode === 'sheet') {
      const dim = el('ws-fb-dim');
      this.viewScope.listen(dim, 'pointerdown', () => this.close());
      root.append(dim);
    }
    const sheet = el(mode === 'tab' ? 'ws-fb-body' : 'ws-fb-sheet ws-glass');
    if (mode === 'sheet') {
      const head = el('ws-fb-head', engineString('s_cf9f0a909975'));
      if (!this.host.touch()) head.append(el('ws-fb-key', engineString('s_a39b6e5111fa')));
      const x = button('ws-fb-close', engineString('s_8db71ed28b0f')); x.setAttribute('aria-label', engineString('s_7d9eb7acb13e')); this.viewScope.listen(x, 'click', () => this.close());
      head.append(x);
      sheet.append(head);
    }
    // the frame + the pen
    const shotBox = el('ws-fb-shot');
    const img = document.createElement('img'); img.alt = 'Screenshot of the frame';
    if (this.shot) img.src = bake(this.shot, this.strokes);
    const draw = button('ws-fb-draw', engineString('s_8a0bfe95dbb7'));
    this.viewScope.listen(draw, 'click', () => this.openPen(img));
    shotBox.append(img, draw);
    const kb = this.shot ? Math.round((bake(this.shot, this.strokes).length * 0.75) / 1024) : 0;
    sheet.append(shotBox, el('ws-fb-meta', this.shot ? engineString('s_38b529db98ff', [this.shot.width, this.shot.height, kb]) : engineString('s_197f0e1f610e')));
    sheet.append(this.chips());
    const text = document.createElement('textarea'); text.className = 'ws-fb-text'; text.rows = mode === 'tab' ? 4 : 3; text.maxLength = 4000;
    text.placeholder = engineString('s_9cffd32a0061'); text.value = this.text;
    this.viewScope.listen(text, 'input', () => { this.text = text.value; });
    if (mode === 'tab') this.viewScope.listen(text, 'keydown', (e) => { if (e.code === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(); } });
    sheet.append(text);
    const c = this.ctx, pos = c['pos'], cam = c['cam'];
    // the host may tag the level with the way it was entered (`entry`, e.g. SF65's legacy / shardfile): its own row
    const level = String(c['shard'] ?? '—'), entry: [string, string][] = typeof c['entry'] === 'string' ? [['Entry', c['entry']]] : [];
    // Explore World notes (src/client/engine/explore/Explore.ts context) describe the viewer: mode, camera, what is on the turntable / selected
    const exploring = typeof c['explore'] === 'string';
    const kv: [string, string][] = exploring ? [
      [engineString('s_level_word'), level], ...entry,
      ['Explore', String(c['explore'])],
      ['Camera', Array.isArray(cam) ? `${Math.round(cam[0] ?? 0)} · ${Math.round(cam[1] ?? 0)} · ${Math.round(cam[2] ?? 0)}` : '—'],
      ['Heading', Array.isArray(cam) && typeof cam[3] === 'number' ? `${headingDeg(cam[3])}°` : '—'],
      ['Model', String(c['model'] ?? c['selected'] ?? '—')],
      ['Tier', String(c['tier'] ?? '—')],
    ] : [
      [engineString('s_level_word'), level], ...entry,
      ['Pos', Array.isArray(pos) ? `${Math.round(pos[0] ?? 0)} · ${Math.round(pos[2] ?? 0)}` : '—'],
      ['Heading', typeof c['yaw'] === 'number' ? `${headingDeg(c['yaw'])}°` : '—'],
      ['Weapon', String(c['weapon'] ?? '—')],
      ['Tier', String(c['tier'] ?? '—')],
      ['FPS', String(c['fps'] ?? '—')],
      ['Build', buildId().slice(0, 7) || 'dev'],
    ];
    const context = el('ws-fb-ctx');
    for (const [key, value] of kv) {
      const row = el('ws-fb-kv', '', 'span'), label = document.createElement('i'); label.textContent = key;
      row.append(label, document.createTextNode(value)); context.append(row);
    }
    sheet.append(context);
    const send = button('ws-fb-send', engineString('s_8675c04a5f9a'));
    this.viewScope.listen(send, 'click', () => { void this.send(); });
    sheet.append(send);
    const q = queuedCount();
    const queued = q > 0 ? `<b class="ws-fb-queued">${q} queued · sends when online</b>` : '';
    if (mode === 'sheet') sheet.append(el('ws-fb-hint', engineString('s_384de4d44de5', [this.host.touch() ? engineString('s_8ec7777d830b') : engineString('s_52f878edb34f'), queued ? engineString('s_614cafefe4f0', [queued]) : ''])));
    else if (queued) sheet.append(el('ws-fb-hint', queued)); // the menu's own hint line explains the tab
    root.append(sheet);
  }

  // ── the pen: full-screen over the frozen frame; strokes are kept normalised and baked at send ──
  private openPen(thumb: HTMLImageElement): void {
    const shot = this.shot;
    if (!shot) return;
    const penScope = this.viewScope.child('pen');
    const pen = el('ws-fb-pen');
    const cv = document.createElement('canvas'); cv.className = 'ws-fb-pencanvas';
    const tools = el('ws-fb-tools');
    const tool = (label: string, fn: () => void, cls = ''): HTMLButtonElement => { const b = button(`ws-fb-tool${cls}`, label); penScope.listen(b, 'click', fn); tools.append(b); return b; };
    pen.append(cv, tools, el('ws-fb-penhint', engineString('s_01300aa1b588')));
    const fit = (): { w: number; h: number } => {
      const k = Math.min(innerWidth / shot.width, innerHeight / shot.height);
      const w = Math.round(shot.width * k), h = Math.round(shot.height * k), dpr = Math.min(2, devicePixelRatio || 1);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      return { w, h };
    };
    const paint = (): void => {
      const g = cv.getContext('2d');
      if (!g) return;
      g.drawImage(shot, 0, 0, cv.width, cv.height);
      g.strokeStyle = '#8fe3ff'; g.lineWidth = Math.max(2, (PEN_PX * cv.width) / SHOT_MAX_W); g.lineCap = 'round'; g.lineJoin = 'round';
      for (const s of this.strokes) {
        g.beginPath();
        for (let i = 0; i + 1 < s.pts.length; i += 2) { const x = (s.pts[i] ?? 0) * cv.width, y = (s.pts[i + 1] ?? 0) * cv.height; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
    };
    fit(); paint();
    let live: Stroke | null = null;
    const at = (e: PointerEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    penScope.listen(cv, 'pointerdown', (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); live = { pts: at(e) }; this.strokes.push(live); paint(); });
    penScope.listen(cv, 'pointermove', (e) => { if (!live) return; live.pts.push(...at(e)); paint(); });
    const end = (): void => { live = null; };
    penScope.listen(cv, 'pointerup', end); penScope.listen(cv, 'pointercancel', end);
    const onResize = (): void => { fit(); paint(); };
    const done = (): void => { penScope.dispose(); pen.remove(); thumb.src = bake(shot, this.strokes); };
    penScope.listen(window, 'resize', onResize);
    tool(engineString('s_a04bd35be167'), () => undefined, ' on');
    tool(engineString('s_a8283ade3185'), () => { this.strokes.pop(); paint(); });
    tool(engineString('s_83b12c2216ef'), () => { this.strokes = []; paint(); });
    tool(engineString('s_11a6767d5674'), done, ' done');
    // on <body>, not inside the composer: the menu's backdrop-filter would make a fixed child fixed to the menu sheet
    for (const t of ['keydown', 'keyup'] as const) penScope.listen(pen, t, (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
    pen.tabIndex = -1;
    mountUi(pen, penScope, document.body);
    app.ui.push('modal', { root: pen, order: 10, back: done }, penScope);
    pen.focus();
  }

  // ── sending ──
  private async send(): Promise<void> {
    const note = this.text.trim();
    if (this.sending) return;
    if (!note) { this.host.toast(engineString('s_c84eeb6c5352')); this.root?.querySelector<HTMLElement>('.ws-fb-input, .ws-fb-text')?.focus(); return; }
    this.sending = true;
    this.root?.classList.add('sending');
    const context: Record<string, ContextValue> = {
      ...this.ctx,
      build: buildId(),
      dpr: devicePixelRatio,
      viewport: `${innerWidth}×${innerHeight}`,
      canvas: this.shot ? `${this.shot.width}×${this.shot.height}` : '',
      ua: navigator.userAgent,
      url: location.href,
      at: new Date().toISOString(),
      repro: reproUrl(location.origin, this.ctx),
    };
    const screenshot = this.shot ? bake(this.shot, this.strokes) : null;
    const r = await sendNote({ note, category: this.category, context, screenshot });
    this.sending = false;
    this.root?.classList.remove('sending');
    if (r === 'locked') { this.host.toast(engineString('s_52f0d7f962de')); return; }
    this.host.toast(r === 'queued' ? engineString('s_eb1976607513') : engineString('s_d406bda74c94', [r.id.slice(-4)]));
    this.text = '';
    this.strokes = [];
    if (this.mode === 'tab') { const panel = this.root?.parentElement; if (panel) await this.mountTab(panel); }
    else this.close();
  }
}

function buildId(): string { try { return __BUILD_ID__; } catch { return ''; } }
