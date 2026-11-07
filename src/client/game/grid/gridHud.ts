/**
 * The grid's HUD moments (SHARD-PLATFORM SF20a / SF20d, Jake's G78, G82, G105, G97; E332 coordinated over herdr). Grid
 * pages only: a shard's own HUD in Select a shard is unchanged.
 *
 * - **G78, the safe zone**: off a shard's cell (the road, the strips, no-man's land) the ATTACK disc dims and a "SAFE ZONE"
 *   chip sits above it (desktop: under the compass). The weapon is already stowed there (G68, `liveSession.ts`).
 * - **G82 / G105, the title card**: crossing from the road into a shard's cell shows one centred card, the shard's name
 *   and its biome line; nothing extra on the road, and not at the page's own arrival (the reveal names the home).
 * - **G97, speed**: near the deck's 30 m/s on the road, a wider FOV and thin speed lines at the screen's edges; no blur.
 *   The FOV offset is added in the late phase and taken off at the next input phase, so the weapon's own FOV is untouched.
 * - **G104, the accent**: inside a cell the HUD's accent variables (the `--ws-cyan` family on #hud) take that shard's
 *   declared accent (`ShardManifest.accent`, one of the 20); on the road they fall back to the reserved HUD cyan.
 */
import type { PerspectiveCamera, Vector3 } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { hudSlots } from '@wildshard/engine/ui/hudSlots';
import type { GridCellEvents } from '../../../shared/game/grid/cellEvents';
import type { GridCellRef } from '../plugin/context';
import { GAME_STRINGS } from '../../../shared/game/strings';
import { accentVars } from '../shardfile/accent';
import { ROAD_ACCENT } from '@wildshard/format/accent';
import { setHudAccent } from '../session/hudAccent';
import { copyAccent } from './copyIdentity';
import './gridHud.css';

export interface GridHudHost {
  readonly scope: Scope;
  readonly hudRoot: HTMLElement;
  readonly camera: PerspectiveCamera;
  readonly cells: GridCellEvents;
  /** the shard's name and its one-line biome for a cell's title card */
  readonly title: (cell: GridCellRef) => { readonly name: string; readonly subtitle: string };
  /** the shard's HUD accent hex for a cell (null: none declared, the road's cyan stays) */
  readonly accent: (cell: GridCellRef) => string | null;
  /** the player's velocity (m/s, in whatever frame it is) */
  readonly velocity: () => Vector3;
  /** in the world and not paused / revealing: the HUD moments show only then */
  readonly live: () => boolean;
  readonly onInput: (fn: () => void) => void;
  readonly onLate: (fn: (dt: number) => void) => void;
}

const CARD_MS = 3200;
/** G97: the speed look ramps in between these road speeds (the deck's cap is 30 m/s) */
const SPEED_FROM = 20, SPEED_FULL = 28.5, FOV_WIDEN = 9;
const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 10-4-1.7-7-5.6-7-10V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

export interface GridHudState { readonly safe: boolean; readonly card: string | null; readonly speed: number; readonly fov: number; readonly accent: string }

/** Install the grid's HUD moments; everything leaves with the level scope. Returns the readout. */
export function installGridHud(host: GridHudHost): () => GridHudState {
  const { scope, hudRoot, camera, cells } = host;
  // G78: the SAFE ZONE chip, above ATTACK on touch (inside the touch layer, its own geometry), under the compass on desktop
  const chip = document.createElement('div'); chip.className = 'ws-grid-safe-chip';
  chip.innerHTML = SHIELD;
  const chipText = document.createElement('span'); chipText.textContent = GAME_STRINGS.grid.safeZone; chip.append(chipText);
  let mounted = false;
  let attack: HTMLElement | null = null;
  const cancel = hudSlots.onLayer((layer) => { layer.append(chip); mounted = true; attack = layer.querySelector<HTMLElement>('.ws-touch-attack'); });
  scope.onDispose(() => { cancel(); chip.remove(); attack?.classList.remove('ws-grid-dim'); });
  // the centred title card
  const card = document.createElement('div'); card.className = 'ws-grid-title';
  const cardName = document.createElement('b'), cardSub = document.createElement('span');
  card.append(cardName, cardSub);
  hudSlots.widget('band.1', card, 0, scope, hudRoot);
  // G97's edge lines
  const lines = document.createElement('div'); lines.className = 'ws-grid-speed';
  hudSlots.widget('band.1', lines, 0, scope, hudRoot);

  let safe = false, shownCard: string | null = null, cardTimer: (() => void) | null = null, speedShown = -1, level = 0, fovApplied = 0;
  const setSafe = (on: boolean): void => {
    if (on === safe) return;
    safe = on;
    hudRoot.classList.toggle('ws-grid-safe', on);
    attack?.classList.toggle('ws-grid-dim', on);
    if (!mounted && on && !chip.isConnected) hudSlots.widget('band.1', chip, 0, scope, hudRoot); // desktop: no touch layer
  };
  let arrived = false; // the page's own arrival (the late subscriber's first call) shows no card: the reveal named it
  scope.onDispose(cells.onEnter((cell) => {
    if (!arrived) return;
    const title = host.title(cell);
    // Shared products can have several independent copies: the stable instance identifies this card.
    const number = /-(\d+)$/u.exec(cell.instance)?.[1];
    const copy = number === undefined ? '' : ` · ${number}`;
    const name = `${title.name}${copy}`;
    cardName.textContent = name; cardSub.textContent = title.subtitle; shownCard = name;
    // restart a showing card's fade in place: a remove / reflow / add forced a whole-page layout on the entry frame
    if (card.classList.contains('show')) for (const fade of card.getAnimations()) fade.currentTime = 0;
    else card.classList.add('show');
    cardTimer?.();
    let live = true; cardTimer = () => { live = false; };
    scope.timeout(CARD_MS, () => { if (!live) return; card.classList.remove('show'); shownCard = null; });
  }));
  arrived = true;
  scope.onDispose(() => { hudRoot.classList.remove('ws-grid-safe'); });
  // G104: the shard's accent inside its cell, the reserved cyan on the road (inline variables on #hud override base.css)
  let accent = ROAD_ACCENT;
  const vars = Object.keys(accentVars(ROAD_ACCENT));
  const setAccent = (hex: string | null): void => {
    accent = hex ?? ROAD_ACCENT;
    setHudAccent(hex); // SF28: the big item cards follow the cell too
    if (hex === null) { for (const name of vars) hudRoot.style.removeProperty(name); return; }
    for (const [name, value] of Object.entries(accentVars(hex))) hudRoot.style.setProperty(name, value);
  };
  // a shared product's copy declares its own accent (copyIdentity.ts), so each template cell reads distinct
  scope.onDispose(cells.onEnter((cell) => { setAccent(copyAccent(cell.instance) ?? host.accent(cell)); }));
  scope.onDispose(cells.onLeave(() => { setAccent(null); }));
  scope.onDispose(() => { setAccent(null); });

  host.onInput(() => { if (fovApplied === 0) return; camera.fov -= fovApplied; fovApplied = 0; camera.updateProjectionMatrix(); });
  scope.onDispose(() => { if (fovApplied !== 0) { camera.fov -= fovApplied; fovApplied = 0; camera.updateProjectionMatrix(); } });
  host.onLate((dt) => {
    const live = host.live();
    setSafe(live && cells.cell === null);
    const v = host.velocity(), speed = Math.hypot(v.x, v.z);
    const target = live && safe ? Math.min(1, Math.max(0, (speed - SPEED_FROM) / (SPEED_FULL - SPEED_FROM))) : 0;
    level += (target - level) * Math.min(1, dt * (target > level ? 4 : 6));
    if (level < 0.01) level = 0;
    const q = Math.round(level * 50) / 50;
    if (q !== speedShown) { speedShown = q; lines.style.setProperty('--grid-speed', String(q)); }
    if (q > 0) { fovApplied = FOV_WIDEN * smoothstep(q); camera.fov += fovApplied; camera.updateProjectionMatrix(); }
  });
  return () => ({ safe, card: shownCard, speed: Math.max(0, speedShown), fov: Math.round(camera.fov * 100) / 100, accent });
}

function smoothstep(t: number): number { return t * t * (3 - 2 * t); }
