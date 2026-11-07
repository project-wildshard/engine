import { bagMenu } from '../bag/tabs';
import { wirePage } from '../shardfile/wirePage';
import { withOwner } from '@wildshard/engine/app/ownership';
import type { ShardContext } from "../plugin/context";
import { installEnteredRuntimeService, retainsRuntimeServices } from "../shard/retainedHooks";
import { app } from '@wildshard/engine/app/runtime';
import { perfLap } from '@wildshard/engine/core/perfLap';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import { lineOfSight } from '@wildshard/engine/physics/query';
import type { HUD } from '@wildshard/engine/ui/HUD';
import { hudSlots } from '@wildshard/engine/ui/hudSlots';
import type { GameMenu } from '@wildshard/engine/ui/Menu';
import type { Interactable } from '@wildshard/engine/world/interact/types';
/**
 * installCompendium — wires the active shard's compendium into the game (one call from main.ts; nothing happens on a
 * shard that registered none). It owns: the state + its save, the tracker's hooks, the book, the ways in, the trophy wall.
 *
 *   installCompendium({ chunkId, game, camera, hud, menu, animals, cabins, interactables, weapons, touchUi, nolock });
 *
 * Ways in: the key N (desktop; J is the lock-on's), the BAG menu's FINDS tab (the journal's stickers, E314 C), the HUD's journal disc (touch,
 * under PAUSE), and EXAMINE on a trophy-wall slot (opens on that entry). Hooks (tracker.ts): an animal within 120 m →
 * discovered; in view within 70 m with a clear line → seen; AnimalManager.onKill → taken (+ its weight); a POI's radius
 * → visited. While the book is open the pointer lock and the weapons are released (like the review composer); closing
 * it resumes through the HUD's own resume path.
 */
import type * as THREE from 'three';
import './compendium.css';
import { compendiumFor } from '../../../shared/game/compendium/registry';
import { CompendiumState } from '../../../shared/game/compendium/state';
import { CompendiumTracker } from '../../../shared/game/compendium/tracker';
import { Journal } from './Journal';
import { compendiumFinds } from '../../../shared/game/compendium/finds';
import type { ShardCompendium } from '../../../shared/game/compendium/types';

export interface CompendiumHost {
  /** Keep authored discovery state resident while journal controls follow the entered cell. */
  context?: ShardContext;
  chunkId: string;
  game: { onUpdate: (fn: (dt: number, t: number) => void, label?: string) => void };
  camera: THREE.Camera;
  hud: HUD;
  menu: GameMenu;
  animals: RowBodiesView;
  /** the shard's cabins (the wall hangs in one) — null on a shard without */
  cabins: { roots: readonly THREE.Object3D[] } | null;
  /** main.ts's prompt list ("[E] …") */
  interactables: Interactable[];
  weapons: { setEnabled: (on: boolean) => void };
  touchUi: () => boolean;
  nolock: boolean;
  wall?: (state: CompendiumState, journal: Pick<Journal, 'open'>) => CompendiumWallPort | null;
}

export interface CompendiumWallPort { refresh: () => void; update: (camera: THREE.Camera) => void }

const GLYPH_BOOK = '<svg viewBox="0 0 24 24"><path d="M4 5.5C6.5 4 9.5 4 12 5.8 14.5 4 17.5 4 20 5.5V19c-2.5-1.4-5.5-1.4-8 .5-2.5-1.9-5.5-1.9-8-.5z M12 5.8V19.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export function installCompendium(host: CompendiumHost): { state: CompendiumState; journal: Journal; wall: CompendiumWallPort | null } | null {
  const def = compendiumFor(host.chunkId);
  if (!def) return null;
  if (host.context !== undefined && retainsRuntimeServices(host.context)) return installRetainedCompendium(host, host.context, def);
  const { hud, menu, weapons } = host;
  const state = new CompendiumState(def);
  const journal = new Journal(state);
  const tracker = new CompendiumTracker(state, {
    canSee: (from, to) => { const p = app.physics; return p === null || lineOfSight(p, from, to, 1.2); },
  });

  // ── ways in ── (the phone's JOURNAL tag: a tag of the base HUD's status column, src/client/engine/ui/hudSlots.ts)
  const disc = document.createElement('button');
  disc.type = 'button'; disc.className = 'ws-cmp-disc';
  disc.innerHTML = `${GLYPH_BOOK}Journal`;
  hudSlots.pill(disc, () => { if (hud.entered) journal.open(); }, journal.scope);
  bagMenu(menu).addFinds('compendium', () => compendiumFinds(state, (id) => { journal.open(id); })); // the BAG's FINDS tab is the journal (E314 C: JOURNAL became FINDS)
  app.input.bind('journal', () => { journal.open(); }, journal.scope, () => hud.entered && !menu.isOpen && !journal.isOpen);

  // ── open / close: release the lock + the weapons, then resume the way the pause menu does ──
  let holdScope = journal.scope.child('resume-hold'), stillScope = journal.scope.child('still');
  journal.onOpen = () => {
    holdScope.dispose(); holdScope = journal.scope.child('resume-hold');
    stillScope.dispose(); stillScope = journal.scope.child('still'); app.ui.holdStill(stillScope); // FC3 (G909): the world holds one still
    hud.holdPause = true;
    weapons.setEnabled(false);
    if (menu.isOpen) menu.close(true);
    if (document.pointerLockElement) document.exitPointerLock();
    disc.classList.remove('new');
  };
  journal.onClose = () => {
    stillScope.dispose();
    hud.onResume?.(); // main.ts's enter(): weapons back on, the pointer re-locked (the CLOSE click / the key is the gesture)
    holdScope.timeout(450, () => {
      hud.holdPause = false;
      if (!host.nolock && !host.touchUi() && !document.pointerLockElement && hud.entered && !menu.isOpen && !journal.isOpen) hud.setPaused(true);
    });
  };

  const wall = host.wall?.(state, journal) ?? null;

  // ── what the book records ──
  state.onChange = (e, _from, to) => {
    const onWall = (def.trophies ?? []).some((t) => t.entry === e.id);
    if (to === 'taken') hud.toast(`Journal · ${e.name} — taken`);
    else if (to === 'seen') hud.toast(`Journal · ${e.kind === 'place' ? 'new place' : 'new page'}: ${e.name}`);
    if (onWall) wall?.refresh(); // taken: the mount goes up; discovered: the chalk name replaces ???
    if (to !== 'discovered') disc.classList.add('new');
  };
  // Kill totals come from the server; the page keeps polling discoveries.
  wirePage.hold({ shard: host.chunkId.replace(/^chunk:\/\/local\//u, ''), journal: state }, journal.scope);
  const eye = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  host.game.onUpdate((dt) => {
    disc.classList.toggle('show', hud.entered && host.touchUi() && !menu.isOpen);
    if (!hud.entered) return;
    const cam = host.camera;
    const e = cam.matrixWorld.elements;
    eye.position.x = e[12]; eye.position.y = e[13]; eye.position.z = e[14];
    eye.forward.x = -e[8]; eye.forward.y = -e[9]; eye.forward.z = -e[10];
    if (!perfLap.active) tracker.update(dt, eye, host.animals.animals); // E350 F-J1: the PERF LAP's spots are not seen / heard of
    wall?.update(cam);
  }, 'engine.compendium.installCompendium');
  return { state, journal, wall };
}

function installRetainedCompendium(host: CompendiumHost, context: ShardContext, def: ShardCompendium): NonNullable<ReturnType<typeof installCompendium>> {
  const { hud, menu, weapons } = host;
  const state = new CompendiumState(def);
  const tracker = new CompendiumTracker(state, {
    canSee: (from, to) => { const physics = context.app.physics; return physics === null || lineOfSight(physics, from, to, 1.2); },
  });
  let current: Journal | undefined;
  const open = (id?: string): void => { current?.open(id); };
  const wall = withOwner(context.scope, () => host.wall?.(state, { open }) ?? null);
  const eye = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  installEnteredRuntimeService(context, (scope) => {
    const borrowedUpdate = Object.getOwnPropertyDescriptor(state, 'onUpdate');
    const borrowedChange = Object.getOwnPropertyDescriptor(state, 'onChange'), borrowedPause = hud.holdPause;
    const journal = new Journal(state); current = journal;
    const disc = document.createElement('button'); disc.type = 'button'; disc.className = 'ws-cmp-disc';
    disc.innerHTML = `${GLYPH_BOOK}Journal`;
    hudSlots.pill(disc, () => { if (hud.entered) journal.open(); }, journal.scope);
    scope.onDispose(bagMenu(menu).addFinds('compendium', () => compendiumFinds(state, (id) => { journal.open(id); })));
    context.app.input.bind('journal', () => { journal.open(); }, journal.scope, () => hud.entered && !menu.isOpen && !journal.isOpen);
    let holdScope = journal.scope.child('resume-hold'), stillScope = journal.scope.child('still');
    journal.onOpen = () => {
      holdScope.dispose(); holdScope = journal.scope.child('resume-hold'); hud.holdPause = true; weapons.setEnabled(false);
      stillScope.dispose(); stillScope = journal.scope.child('still'); context.app.ui.holdStill(stillScope); // FC3 (G909)
      if (menu.isOpen) menu.close(true);
      if (document.pointerLockElement) document.exitPointerLock();
      disc.classList.remove('new');
    };
    journal.onClose = () => {
      stillScope.dispose(); hud.onResume?.();
      holdScope.timeout(450, () => {
        hud.holdPause = false;
        if (!host.nolock && !host.touchUi() && !document.pointerLockElement && hud.entered && !menu.isOpen && !journal.isOpen) hud.setPaused(true);
      });
    };
    state.onChange = (entry, _from, to) => {
      if (to === 'taken') hud.toast(`Journal · ${entry.name} — taken`);
      else if (to === 'seen') hud.toast(`Journal · ${entry.kind === 'place' ? 'new place' : 'new page'}: ${entry.name}`);
      if ((def.trophies ?? []).some((trophy) => trophy.entry === entry.id)) wall?.refresh();
      if (to !== 'discovered') disc.classList.add('new');
    };
    wirePage.hold({ shard: context.manifest.slug, journal: state }, scope);
    context.app.addSystem({ id: `game.compendium.${context.manifest.slug}`, phase: 'update', run: (dt) => {
      disc.classList.toggle('show', hud.entered && host.touchUi() && !menu.isOpen);
      if (!hud.entered) return;
      const elements = host.camera.matrixWorld.elements;
      eye.position.x = elements[12]; eye.position.y = elements[13]; eye.position.z = elements[14];
      eye.forward.x = -elements[8]; eye.forward.y = -elements[9]; eye.forward.z = -elements[10];
      if (!perfLap.active) tracker.update(dt, eye, host.animals.animals);
      wall?.update(host.camera);
    } }, scope);
    scope.onDispose(() => {
      delete journal.onClose; journal.close(); hud.holdPause = borrowedPause;
      if (borrowedUpdate === undefined) delete state.onUpdate; else Object.defineProperty(state, 'onUpdate', borrowedUpdate);
      if (borrowedChange === undefined) delete state.onChange; else Object.defineProperty(state, 'onChange', borrowedChange);
      if (current === journal) current = undefined;
    });
  });
  return { state, wall, get journal() { if (current === undefined) throw new Error('Journal left its cell'); return current; } };
}
