/**
 * Entering Infinite Wildshard (SHARD-PLATFORM SF21a, Jake's G98 "B Sky-down reveal"; G622 D1: 3 s, any touch skips):
 * the camera comes down from about 400 m over Driftwood's pier to the player's eye at the spawn, showing the road and
 * the neighbours on the way.
 *
 * - It runs in the page's late phase, after the player has placed the camera: each frame reads that pose as the landing
 *   pose, so a spawn that settles on the pier is followed, and the next frame's player update starts from scratch.
 * - The weapon is off and hidden. Input is live from the loader's end (loading-speed R1): any touch, key, button or stick
 *   ends the reveal and is the player's own. The HUD is invisible while the camera flies but takes touches, so the touch
 *   that skips is already a stick or look drag; until the first frame draws, a touch skips the whole path.
 * - It ends at the path's end: controls never wait for the rings or the home cell's simulation handoff (`gridHomeSim`),
 *   whose times it still records; the existing soft walls hold what is not ready. A real-time ceiling and the
 *   menu/background release cannot depend on gameplay frames.
 * - `window.__wsReveal` carries the timings (ms from the reveal's start) for the menu capture (`sf21a/menu.mjs --reveal`).
 */
import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import { listenPage } from '@wildshard/engine/input/dom';
import { hudSlots } from '@wildshard/engine/ui/hudSlots';
import { GAME_STRINGS } from '../../../shared/game/strings';
import './gridHud.css';

/** the reveal's timings, in ms of the page clock from its first frame (null: not reached yet) */
export interface RevealTimings {
  readonly startedAt: number; readonly pathEndMs: number | null; readonly ringsReadyMs: number | null; readonly homeSimMs: number | null;
  readonly endedMs: number | null; readonly skipped: boolean; readonly ceiling: boolean;
}
declare global { interface Window { __wsReveal?: RevealTimings } }

export interface GridRevealHost {
  readonly scope: Scope;
  readonly camera: PerspectiveCamera;
  /** the page's #hud root (the reveal hides the HUD under it with a class while it runs) */
  readonly hudRoot: HTMLElement;
  /** the renderer's canvas: hidden until the reveal's first frame draws */
  readonly canvas: HTMLElement;
  /** the page's late phase, registered after the player's camera */
  readonly onLate: (fn: (dt: number) => void) => void;
  /** the home shard's name for the caption */
  readonly home: string;
  /** the rings' readiness (every visible neighbour drawn): recorded, never waited for */
  readonly ringsReady: () => boolean;
  /** the home simulation's handoff (true once it arrived, or when none is on its way): recorded, never waited for */
  readonly homeSimReady: () => boolean;
  /** the weapon gate (EquipmentService) */
  readonly weapons: { readonly enabled: boolean; setEnabled: (on: boolean) => void; visible: boolean };
  /** the camera's first-person layer (arms, weapon, board): hidden while the camera flies */
  readonly viewmodel: { visible: boolean };
  /** has the player entered the world (the reveal starts on the first late frame in) */
  readonly entered: () => boolean;
}

/** how long the path takes (G622 D1), and the sky pose relative to the landing pose */
const PATH_S = 3;
const SKY_UP = 400, SKY_BACK = 170, LOOK_AHEAD = 140;
/** past the path's end, the wall-clock backstop for a loop that stopped drawing */
const CEILING_MS = 2000;

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Install the sky-down reveal on a grid page; it removes itself when it ends or the level scope goes. Returns whether it runs
 *  now (the HUD moments wait for it). */
export function installGridReveal(host: GridRevealHost): () => boolean {
  const { camera } = host;
  const scope = host.scope.child('grid.reveal');
  let started = -1, live = true, skipped = false, ceiling = false;
  let pathEnd: number | null = null, ringsAt: number | null = null, homeAt: number | null = null, endedAt: number | null = null;
  let layer: HTMLElement | null = null;
  let viewmodelWas = true;
  const wasEnabled = host.weapons.enabled, wasVisible = host.weapons.visible;
  const land = new Vector3(), landQ = new Quaternion(), sky = new Vector3(), skyQ = new Quaternion(), look = new Vector3(), fwd = new Vector3(), m = new Matrix4();
  const now = (): number => app.clock.mode === 'capture' ? app.clock.real * 1000 : diagnosticNow();
  const publish = (): void => {
    window.__wsReveal = { startedAt: started, pathEndMs: pathEnd, ringsReadyMs: ringsAt, homeSimMs: homeAt, endedMs: endedAt, skipped, ceiling };
  };
  const end = (at: number): void => {
    if (!live) return;
    live = false; endedAt = at - started;
    host.hudRoot.classList.remove('ws-grid-revealing', 'ws-grid-live');
    if (layer !== null) hudSlots.discard(layer);
    layer = null;
    host.weapons.setEnabled(wasEnabled); host.weapons.visible = wasVisible;
    host.viewmodel.visible = viewmodelWas;
    publish();
    scope.dispose();
  };
  const begin = (at: number): void => {
    started = at;
    host.canvas.style.visibility = ''; // this frame draws the sky pose (the late phase runs before the render)
    host.weapons.setEnabled(false); host.weapons.visible = false;
    viewmodelWas = host.viewmodel.visible;
    host.hudRoot.classList.add('ws-grid-revealing');
    const el = document.createElement('div'); el.className = 'ws-grid-reveal';
    const caption = document.createElement('div'); caption.className = 'ws-grid-reveal-caption';
    const title = document.createElement('b'); title.textContent = GAME_STRINGS.grid.reveal(host.home);
    const hint = document.createElement('span'); hint.textContent = GAME_STRINGS.grid.revealSkip;
    caption.append(title, hint); el.append(caption);
    host.hudRoot.classList.add('ws-grid-live');
    hudSlots.widget('band.1', el, 0, scope, host.hudRoot);
    layer = el;
    publish();
    // A paused/gated loop never reaches onLate: capture keeps its deterministic clock, live play has a wall-time backstop.
    if (app.clock.mode === 'live') scope.timeout(PATH_S * 1000 + CEILING_MS, () => { ceiling = true; end(now()); });
  };
  scope.onDispose(() => {
    host.canvas.style.visibility = '';
    if (live && started < 0) host.hudRoot.classList.remove('ws-grid-revealing');
    if (live && started >= 0) { live = false; host.hudRoot.classList.remove('ws-grid-revealing', 'ws-grid-live'); host.viewmodel.visible = viewmodelWas; }
  });
  // From the loader's end until the first gated frame (gameplay ready), nothing of this world has been drawn: the canvas
  // still holds the loading steps' warm-up draws. Both it and the HUD stay hidden until `begin` (round 40: a 0.4 s frame
  // of the HUD over broken orange and blue triangles on the phone).
  host.hudRoot.classList.add('ws-grid-revealing'); host.canvas.style.visibility = 'hidden';
  const release = (): void => { if (live && started >= 0) end(now()); };
  // any touch or click takes over: before the touch layer sees it (the capture phase), so the same touch moves or looks
  let skipAsked = false;
  const skip = (): void => {
    if (!live) return;
    if (started < 0) { skipAsked = true; return; } // before the first frame: the reveal ends on it, at the landing pose
    skipped = true; pathEnd ??= now() - started; end(now());
  };
  listenPage(scope, 'pointerdown', skip, { capture: true });
  // while the camera flies, the player's input is dropped before it is collected, unless it asks for control: a key, a
  // button or a stick since the last frame ends the reveal and goes through
  const intent = (): boolean => { const state = app.input.snapshot(); return state.physical.length + state.manual.length + state.presses.length > 0 || state.axes.some((axis) => axis.x !== 0 || axis.y !== 0); };
  app.addSystem({ id: 'game.grid.reveal.input', phase: 'input', before: ['engine.input.collect'], run: () => {
    if (!live || started < 0) return;
    if (intent()) skip(); else app.input.clear();
  } }, scope);
  // A pause menu must be visible and usable rather than hidden beneath arrival.
  scope.listen(window, 'ws-menu', release);
  scope.listen(document, 'ws:background', release);
  scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') release(); });

  host.onLate(() => {
    if (!live || !host.entered()) return;
    const at = now();
    if (started < 0) { begin(at); if (skipAsked) { skip(); return; } }
    const ms = at - started;
    if (ringsAt === null && host.ringsReady()) ringsAt = ms;
    if (homeAt === null && host.homeSimReady()) homeAt = ms;
    if (ms >= PATH_S * 1000) { pathEnd = ms; end(at); return; } // the landing pose is the player's own camera
    const u = clamp01(ms / (PATH_S * 1000));
    host.viewmodel.visible = false; // the arms come back with control
    // the landing pose is where the player put the camera this frame; the sky pose hangs back and up, looking ahead of it
    land.copy(camera.position); landQ.copy(camera.quaternion);
    fwd.set(0, 0, -1).applyQuaternion(landQ); fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    sky.copy(land).addScaledVector(fwd, -SKY_BACK); sky.y += SKY_UP;
    look.copy(land).addScaledVector(fwd, LOOK_AHEAD);
    m.lookAt(sky, look, camera.up); skyQ.setFromRotationMatrix(m);
    // horizontal glide eases in and out; the height falls fast, then settles; the view levels out over the last 60 %
    const glide = smooth(u), fall = 1 - (1 - u) ** 3, level = smooth(clamp01((u - 0.4) / 0.6));
    camera.position.set(sky.x + (land.x - sky.x) * glide, sky.y + (land.y - sky.y) * fall, sky.z + (land.z - sky.z) * glide);
    camera.quaternion.slerpQuaternions(skyQ, landQ, level);
    camera.updateMatrixWorld();
  });
  return () => live;
}
