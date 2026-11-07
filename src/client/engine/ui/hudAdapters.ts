import { Vector2, Vector3 } from 'three';
import type { Game } from '../core/Game';
import type { Scope } from '../../../shared/engine/app/scope';
import type { LevelAdapters } from '../../../server/engine/level/context';
import { hudSlots, type DiscSpot, type TouchRelabel } from './hudSlots';
import { controlRects, placePin, type PinRect } from './pinKeepOut';

/** Scope-owned projection and relabels; content supplies only world positions and elements. */
export function hudAdapters(game: Game, scope: Scope, root: HTMLElement,
  relabel: (spot: DiscSpot, hint: TouchRelabel | null) => void): NonNullable<LevelAdapters['hud']> {
  hudSlots.configure(game.level.hud?.bands);
  const pins = new Set<{ at: Vector3 | (() => Vector3 | null); el: HTMLElement; x: number; y: number; w: number; h: number; shown: boolean }>();
  const point = new Vector3();
  const viewSize = new Vector2(), viewport = { width: 0, height: 0 };
  // pins step round the touch controls (pinKeepOut.ts): the controls' rects and the pins' sizes are read every 15th frame
  // (≈ 2–4 Hz), never per frame; the controls themselves never move
  let keepOut: readonly PinRect[] = [], frame = 0;
  game.app.addSystem({ id: 'engine.hud.pins', phase: 'late', run: () => {
    if (pins.size === 0) return;
    if (frame++ % 15 === 0) {
      keepOut = hudSlots.touch ? controlRects(root) : [];
      for (const pin of pins) if (pin.shown) { pin.w = pin.el.offsetWidth; pin.h = pin.el.offsetHeight; }
    }
    let viewportRead = false;
    for (const pin of pins) {
      const at = typeof pin.at === 'function' ? pin.at() : pin.at;
      if (at !== null) point.copy(at).project(game.camera);
      const visible = at !== null && point.z >= -1 && point.z <= 1;
      // Game.resize owns this same native viewport in logical CSS pixels.
      // Read its stored size before the first pin write, without synchronously
      // flushing HUD styles through window dimensions. Readers stay in order.
      if (visible && !viewportRead) { game.renderer.getSize(viewSize); viewport.width = viewSize.x; viewport.height = viewSize.y; viewportRead = true; }
      const raw = visible ? { x: Math.round((point.x + 1) * viewport.width / 2), y: Math.round((1 - point.y) * viewport.height / 2) } : null;
      const placed = raw === null || keepOut.length === 0 ? raw : placePin(raw.x, raw.y, pin.w, pin.h, keepOut, viewport);
      const shown = placed !== null;
      if (shown !== pin.shown) { pin.shown = shown; pin.el.style.display = shown ? 'block' : 'none'; if (shown) frame = 0; }
      if (placed === null) continue;
      const x = Math.round(placed.x), y = Math.round(placed.y);
      if (x !== pin.x || y !== pin.y) { pin.x = x; pin.y = y; pin.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`; }
    }
  } }, scope);
  const labels = new Map<DiscSpot, { hint: TouchRelabel }[]>();
  return {
    widget: (band, el, order) => { hudSlots.widget(band, el, order, scope, root); return () => { hudSlots.discard(el); }; },
    disc: (opts) => { const button = hudSlots.disc(opts, scope); return { button, dispose: () => { hudSlots.discard(button); } }; },
    relabel: (spot, label, icon, appearance) => {
      const entry = { hint: appearance ?? { label, icon, tone: 'rest' as const } };
      const list = labels.get(spot) ?? []; labels.set(spot, list); list.push(entry); relabel(spot, entry.hint);
      return () => { const at = list.indexOf(entry); if (at !== -1) list.splice(at, 1); relabel(spot, list.at(-1)?.hint ?? null); };
    },
    verb: (slot, opts) => {
      const button = hudSlots.disc({ ...opts, cls: 'ws-verb', spot: slot === 'verb.1' ? 'lean-l' : 'lean-r' }, scope);
      hudSlots.show(button, true); return () => { hudSlots.discard(button); };
    },
    pin: (at, el) => {
      Object.assign(el.style, { position: 'fixed', left: '0', top: '0', display: 'none', pointerEvents: 'none', willChange: 'transform' });
      const pin = { at, el, x: Number.NaN, y: Number.NaN, w: 0, h: 0, shown: false }; pins.add(pin); hudSlots.widget('band.1', el, 0, scope, root);
      return () => { pins.delete(pin); el.remove(); };
    },
  };
}
