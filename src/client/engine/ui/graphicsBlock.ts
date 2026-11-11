import type { Scope } from '../../../shared/engine/app/scope';
import { engineString, type EngineStringKey } from '../../../shared/engine/strings';
import { listenTap } from '../input/dom';
import { TIER, TIER_CONFIG, automaticTier, gfxPrefs, saveGfxPrefs } from '../core/tier';
import { drawingBuffer, drawingPixelRatio } from '../core/devPixels';
import { graphicsMode, lowPowerOn, lowPowerRefusal, PIXELS_EVENT } from '../core/graphicsMode';
import {
  applyPreset, DENSITIES, densityIn, flagOn, frameReadout, presetLabel, saveDensity, saveFlag, saveWorldToggle, shippedLook, worldToggleOn,
  type FlagKnob,
} from '../core/graphicsQuality';
import { savedSetting, saveSetting } from './Settings';
import { registerGraphicsControl } from './graphicsControls';
/**
 * MOBILE-GRAPHICS MG8: the phone's Graphics controls. Jake, 2026-11-10 ~22:50 Cancún: "Everything needs to be in the graphic
 * settings"; ~23:05: Low · High · Custom; ~23:45: one "Pixel density" control, no "Auto" anywhere, anti-aliasing On / Off.
 *
 *   mode            Low | High | Custom   presets; Custom only lights up (graphicsQuality.ts presetLabel)
 *   density         1× | 1.25× | 1.5× | 2× with the drawing size under it
 *   shadows, bloom, rays, aa              On | Off
 *   readout         the cap in force now, and the last play's fps, frame time and draws
 *   world           In-world toggle On | Off (MG9's card on every entry)
 *
 * Each row is its own factory: layout A's Graphics tab takes them through its registry (registerGraphicsSettings, replacing
 * its built-in `mode`, `tier`, `scale` and `aa`), and the title's Settings stacks them (buildGraphicsBlock). Every control
 * always shows a real value and applies at once (core/graphicsQuality.ts, Game.applyQuality); Low Power Mode refuses High (MG3).
 */

type RowId = 'mode' | 'modeCards' | 'density' | 'shadows' | 'bloom' | 'rays' | 'aa' | 'readout' | 'world';
interface Row { readonly root: HTMLElement; readonly paint: () => void }

const el = (cls: string, text = '', tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.className = cls; if (text !== '') e.textContent = text; return e; };
const s = (key: EngineStringKey, args: readonly unknown[] = []): string => engineString(key, args);
const DENSITY_WORDS: Readonly<Record<string, EngineStringKey>> = { '1': 's_gfx_d1', '1.25': 's_gfx_d125', '1.5': 's_gfx_d15', '2': 's_gfx_d2' };
const FLAG_WORDS: Readonly<Record<FlagKnob, EngineStringKey>> = { shadows: 's_gfx_shadows', bloom: 's_gfx_bloom', rays: 's_gfx_rays', aa: 's_gfx_aa' };
const shipped = (id: FlagKnob): boolean => id === 'shadows' ? true : shippedLook()[id];

/** One Graphics row, painted on open, on every pixel / preset change and twice a second while it lives. */
export function graphicsRow(id: RowId, scope: Scope): Row {
  const paints: (() => void)[] = [];
  const paint = (): void => { for (const p of paints) p(); };
  const seg = (label: string, options: readonly { v: string; text: string; indicator?: boolean }[], get: () => string, set: (v: string) => void): HTMLElement => {
    const row = el('ws-gmenu-row');
    row.append(el('ws-gmenu-swlabel', label, 'span'));
    const box = el('ws-gmenu-seg');
    for (const o of options) {
      const b = el('ws-gmenu-segbtn', o.text, 'button') as HTMLButtonElement; b.type = 'button'; b.dataset['v'] = o.v;
      if (o.indicator === true) { b.disabled = true; b.classList.add('indicator'); } else listenTap(scope, b, () => { set(o.v); paint(); });
      box.append(b);
    }
    paints.push(() => { const now = get(); for (const c of box.children) (c as HTMLElement).classList.toggle('active', (c as HTMLElement).dataset['v'] === now); });
    row.append(box);
    return row;
  };
  const onOff = [{ v: 'on', text: s('s_gfx_on') }, { v: 'off', text: s('s_gfx_off') }];
  let root: HTMLElement;
  if (id === 'mode' || id === 'modeCards') {
    // Low · High · Custom. The tab draws them as its three big cards; the title as one picker row
    const refusal = el('ws-gmenu-note');
    let refused = false;
    const press = (mode: 'low' | 'high'): void => { refused = !applyPreset(mode); paint(); };
    if (id === 'modeCards') {
      const cards = el('ws-gmenu-svmode');
      const words = { low: ['s_st_low', 's_st_low_sub'], high: ['s_st_high', 's_st_high_sub'], custom: ['s_st_custom', 's_st_custom_sub'] } as const;
      for (const mode of ['low', 'high', 'custom'] as const) {
        const card = el('ws-gmenu-svmodecard', '', 'button') as HTMLButtonElement; card.type = 'button'; card.dataset['mode'] = mode;
        card.append(el('ws-gmenu-svmodeword', s(words[mode][0]), 'b'), el('ws-gmenu-svsub', s(words[mode][1]), 'small'));
        if (mode === 'custom') { card.disabled = true; card.classList.add('indicator'); } else listenTap(scope, card, () => { press(mode); });
        cards.append(card);
      }
      paints.push(() => {
        const now = presetLabel(), locked = lowPowerOn();
        for (const card of cards.children) {
          const mode = (card as HTMLElement).dataset['mode'], on = mode === now;
          card.classList.toggle('active', on); card.setAttribute('aria-pressed', String(on)); card.classList.toggle('locked', locked && mode === 'high');
        }
      });
      root = el('ws-gmenu-svmodewrap'); root.append(cards, refusal, el('ws-gmenu-note', s('s_gfx_block_note')));
    } else {
      root = el('ws-gmenu-gfxmode');
      root.append(seg(s('s_gfx_mode'), [{ v: 'low', text: s('s_gfx_low_start') }, { v: 'high', text: s('s_gfx_high_start') }, { v: 'custom', text: s('s_st_custom'), indicator: true }],
        () => presetLabel(), (v) => { if (v === 'low' || v === 'high') press(v); }), refusal, el('ws-gmenu-note', s('s_gfx_block_note')));
    }
    paints.push(() => { if (!lowPowerOn()) refused = false; refusal.textContent = lowPowerRefusal(); refusal.hidden = !refused && !lowPowerOn(); });
  } else if (id === 'density') {
    const drawing = el('ws-gmenu-note');
    paints.push(() => {
      const ratio = drawingPixelRatio(window.devicePixelRatio, TIER_CONFIG.dpr, true);
      const buffer = drawingBuffer(window.innerWidth, window.innerHeight, ratio);
      drawing.textContent = s('s_gfx_drawing', [buffer.width, buffer.height, Math.round(window.innerWidth * window.devicePixelRatio), Math.round(window.innerHeight * window.devicePixelRatio)]);
    });
    root = el('ws-gmenu-gfxdensity');
    root.append(seg(s('s_gfx_density'), DENSITIES.map((d) => ({ v: String(d), text: s(DENSITY_WORDS[String(d)] ?? 's_gfx_d2') })),
      () => String(densityIn(graphicsMode())), (v) => { const d = DENSITIES.find((x) => String(x) === v); if (d !== undefined) saveDensity(d); }), drawing);
  } else if (id === 'readout') {
    root = el('ws-gmenu-note ws-gmenu-gfx-readout');
    paints.push(() => { const line = frameReadout(); root.textContent = line === '' ? s('s_gfx_readout_idle') : line; });
  } else if (id === 'world') {
    root = seg(s('s_gfx_world_toggle'), onOff, () => worldToggleOn() ? 'on' : 'off', (v) => { saveWorldToggle(v === 'on'); });
  } else {
    const flag = id;
    root = seg(s(FLAG_WORDS[flag]), onOff, () => flagOn(flag, graphicsMode(), shipped(flag)) ? 'on' : 'off', (v) => { saveFlag(flag, v === 'on'); });
  }
  scope.listen(document, PIXELS_EVENT, paint);
  scope.interval(500, paint);
  paint();
  return { root, paint };
}

/** The title's Settings on a phone: every row stacked (null elsewhere: the desktop keeps its render scale and AA rows). */
export function buildGraphicsBlock(scope: Scope): Row | null {
  if (TIER !== 'phone') return null;
  const rows = (['mode', 'density', 'shadows', 'bloom', 'rays', 'aa', 'readout', 'world'] as const).map((id) => graphicsRow(id, scope));
  const root = el('ws-gmenu-gfx');
  root.append(...rows.map((r) => r.root));
  return { root, paint: () => { for (const r of rows) r.paint(); } };
}

/**
 * Layout A's Graphics tab (settingsTabs.ts, its registry graphicsControls.ts): the phone's rows, and the built-ins they replace.
 * `mode` becomes Low · High · Custom; `tier` shows Phone / Desktop with no Auto; on a phone `scale` and `aa` hide (Pixel density
 * and Anti-aliasing are the controls), while a desktop keeps its boot-time render scale and AA as they were. Returns the
 * disposer (each registration's).
 */
export function registerGraphicsSettings(): () => void {
  const phone = (): boolean => TIER === 'phone';
  const row = (id: RowId) => (scope: Scope): HTMLElement => graphicsRow(id, scope).root;
  const pick = (scope: Scope, label: string, options: readonly (readonly [string, string])[], get: () => string, set: (v: string) => void): HTMLElement => {
    const r = el('ws-gmenu-row'); r.append(el('ws-gmenu-swlabel', label, 'span'));
    const box = el('ws-gmenu-seg');
    const paint = (): void => { for (const c of box.children) (c as HTMLElement).classList.toggle('active', (c as HTMLElement).dataset['v'] === get()); };
    for (const [v, text] of options) {
      const b = el('ws-gmenu-segbtn', text, 'button') as HTMLButtonElement; b.type = 'button'; b.dataset['v'] = v;
      listenTap(scope, b, () => { set(v); paint(); }); box.append(b);
    }
    scope.interval(1000, paint); paint(); r.append(box); return r;
  };
  const offs = [
    registerGraphicsControl({ id: 'mode', section: 'main', order: 0, when: phone, build: row('modeCards') }),
    registerGraphicsControl({ id: 'gfxDensity', section: 'main', order: 10, when: phone, build: row('density') }),
    registerGraphicsControl({ id: 'gfxReadout', section: 'main', order: 20, when: phone, build: row('readout') }),
    registerGraphicsControl({ id: 'gfxShadows', section: 'effects', order: 10, when: phone, build: row('shadows') }),
    registerGraphicsControl({ id: 'gfxBloom', section: 'effects', order: 20, when: phone, build: row('bloom') }),
    registerGraphicsControl({ id: 'gfxRays', section: 'effects', order: 30, when: phone, build: row('rays') }),
    registerGraphicsControl({ id: 'gfxAa', section: 'effects', order: 40, when: phone, build: row('aa') }),
    registerGraphicsControl({ id: 'gfxWorld', section: 'setup', order: 10, when: phone, build: row('world') }),
    // "I don't like auto": Quality shows the tier this device runs
    registerGraphicsControl({ id: 'tier', section: 'advanced', order: 10, build: (scope) => pick(scope, s('s_1b2c08a8733d'), [['phone', s('s_63dceb8800b2')], ['desktop', s('s_9bd88f2485ac')]],
      () => { const saved = savedSetting('tier'); return saved === 'auto' ? automaticTier : saved; }, (v) => { if (v === 'phone' || v === 'desktop') saveSetting('tier', v); }) }),
    // a desktop's boot-time render scale and AA, as the built-ins had them; a phone has Pixel density and Anti-aliasing instead
    registerGraphicsControl({ id: 'scale', section: 'advanced', order: 20, when: () => !phone(), build: (scope) => pick(scope, s('s_2dee7435d0fe'),
      [['1', s('s_aa23e5562422')], ['1.25', s('s_dfbe15a4b4a5')], ['1.5', s('s_79105e58c657')], ['2', s('s_d1ce94426019')], ['native', s('s_d509e4938852')], ['auto', s('s_0286249762f7')]], () => gfxPrefs.dpr,
      (v) => { if (v === 'auto' || v === '1' || v === '1.25' || v === '1.5' || v === '2' || v === 'native') { gfxPrefs.dpr = v; saveGfxPrefs(); } }) }),
    registerGraphicsControl({ id: 'aa', section: 'advanced', order: 30, when: () => !phone(), build: (scope) => pick(scope, s('s_c77c3af22c64'),
      [['on', s('s_130011756125')], ['off', s('s_ca7981b46ecf')], ['auto', s('s_0286249762f7')]], () => gfxPrefs.aa,
      (v) => { if (v === 'auto' || v === 'on' || v === 'off') { gfxPrefs.aa = v; saveGfxPrefs(); } }) }),
  ];
  return () => { for (const off of offs) off(); };
}
