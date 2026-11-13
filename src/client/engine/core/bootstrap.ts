import { harnessPins } from '../../../shared/engine/app/identity';
import { installGameplayInput } from '../input/gameplay';
import type { InputContextDef } from '../../../server/engine/level/context';
import { app } from '../app/runtime';
import type * as THREE from 'three';
import { Game } from './Game';
import { applyLevelTier, TIER } from './tier';
import { noteDeviceGpu } from '../telemetry/deviceSnapshot';
import { readyWebGLContext } from './webglStartup';
import { recordBootCheckpoint } from '../boot/bootTrace';
import { issueBakedPrograms } from '../boot/earlyPrograms';
import { TERRAIN_RES } from '../../../shared/engine/core/config';
import { Terrain } from '../world/Terrain';
import { TreeFactory } from '../world/TreeFactory';
import { Forest } from '../world/forest/Forest';
import { Player } from '../player/Player';
import type { SkyRig as Sky } from '../world/skyRig';
import { Tour } from './Tour';
import * as Heightfield from '../../../shared/engine/world/Heightfield';
import { terrainFieldFor } from '../../../shared/engine/world/groundField';
import { macrotask, slicer, type StepRunner } from '../boot/plan';
import { levelBakedId, needsTerrainCollider, type LevelSpec } from '../../../shared/engine/level/spec';
import { loadRapier } from '../../../shared/engine/physics/rapier';
import { Physics } from '../../../shared/engine/physics/Physics';
import { setActiveBodies, setActivePhysics } from '../physics/active';
import { loadNavmesh } from '../physics/navmeshLoad';
import { setRagdollClock } from '../physics/ragdoll';
import { Bodies, BODY_CAP } from '../../../shared/engine/physics/bodies';
import { addLevelTerrain } from '../../../shared/engine/physics/terrain';
import { addPiece } from '../../../shared/engine/physics/pieces';
import type { WorldRegistry } from '../world/registry';
import { installPhysicsDebug } from '../physics/debug';
import { installCrashFlag } from './crashFlag';
import { enteredOwner, withOwner } from '../../../shared/engine/app/ownership';

export interface World {
  game: Game;
  sky: Sky;
  terrain: Terrain;
  forest: Forest;
  player: Player;
  /** the shard's Rapier world (src/engine/physics/), stepped in Game's fixed 60 Hz loop */
  physics: Physics;
  /** every built thing, registered once (src/client/engine/world/registry.ts): the scene, physics and the floors listen here */
  registry: WorldRegistry;
  tour: Tour;
  /** Explore World owns the camera (src/client/engine/explore/Explore.ts): the player is not updated and does not drive it */
  freeCamera: boolean;
  params: URLSearchParams;
  num: (key: string, fallback: number) => number;
}

/**
 * Builds the base chunk (renderer, sky, terrain, forest, player) and returns the handles.
 * Feature entry points (dev/*.html) and main.ts both start here.
 *
 * URL params: ?chunk=<slug>  which shard (default driftwood-isle, see src/client/game/shard/registry.ts)
 *             ?x=&z=&yaw=&pitch=  spawn pose (metres / radians)
 */
export async function bootstrap(step: StepRunner, level: LevelSpec, inputContexts: readonly InputContextDef[] = []): Promise<World> {
  applyLevelTier(level.tiers?.[TIER]);
  const params = new URLSearchParams(location.search);
  const num = (k: string, d: number): number => { const v = params.get(k); return v === null ? d : Number.parseFloat(v); };
  // The selected shard was resolved before main.ts removes ?chunk from a standalone PWA URL.
  const def = level;
  const rapier = loadRapier(); // streamed compile from the first moment of boot; the `physics` step below awaits it
  const navmesh = loadNavmesh(def.id, levelBakedId(def), def.navigation);
  void navmesh.catch(() => undefined); // Preserve the fatal awaited physics step without an early unhandled rejection. // the shard's baked navmesh (P6b), a declared boot file; the `physics` step awaits it
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = await step('renderer', async (progress) => {
    // SF67: the session's file lists and prefetch, then the context and the renderer, were one 100-116 ms task at 4x CPU.
    // (No task between the context check and the renderer: three reads the context's capabilities at once, E257.)
    await macrotask();
    const context = await readyWebGLContext(canvas, (state) => {
      progress.detail('Waiting for graphics to recover');
      recordBootCheckpoint('renderer:waiting', { ...state });
    });
    const made = new Game(canvas, context, level);
    noteDeviceGpu(context); // DEVICE-TELEMETRY DT1: the game's own context names its GPU for the device snapshot
    return made;
  });
  game.app.clock.setCapture(harnessPins()?.capture ?? null);
  issueBakedPrograms(game); // DL10 (Debug 'Early shader compile'): a queued list of the level's entry programs starts linking
  const sky = await step('sky', (p) => game.buildSky((text) => { p.detail(text); }));
  game.retainEngineScene();
  const terrain = await step('terrain', async (p) => {
    const t = await new Terrain().build(level.ground, game.look?.terrainPainter, game.levelScope); // a look with its own ground paints it (LookStrategy.terrainPainter)
    t.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) sky.setupMaterial(m); });
    game.scene.add(t.group);
    p.detail(`${TERRAIN_RES}² heightfield${def.assets ? ` · ${def.assets.groundLayers.length} splat layers` : ''}`);
    return t;
  });
  const factory = await step('cards', async () => typeof def.trees?.factory === 'function' ? (await def.trees.factory())(game.renderer, sky) : new TreeFactory(game.renderer).buildEmpty());
  const forest = await step('forest', async (p) => {
    // 'model': the shard's tree model draws them (E315); SF67: the placement ~30 ms a task
    const f = await new Forest(factory, sky).buildSliced({ drawnBy: def.trees?.drawnBy ?? 'self' }, slicer(30).due);
    if (f.trees.length === 0) f.group.visible = false; // an ocean shard: the empty needle / twig batches still cost 24k tris + shadow draws on the phone
    else game.scene.add(f.group);
    terrain.applyCanopy(f.canopyMap);
    p.detail(`${f.trees.length.toLocaleString()} ${def.trees?.noun ?? 'trees'}`);
    return f;
  });

  const physics = await step('physics', async (p) => {
    const ph = new Physics(await rapier);
    await navmesh;
    withOwner(game.levelScope, () => {
      if (needsTerrainCollider(level)) addLevelTerrain(ph, level.ground.collider); // a structure-first shard walks on its built floors only
    });
    p.detail(`${ph.world.colliders.len()} colliders`);
    return ph;
  });
  setActivePhysics(physics); // weapons, aim assist, interact query it (src/client/engine/physics/active.ts)
  setRagdollClock(() => game.alpha); // ragdoll poses interpolate between fixed steps like everything else
  installPhysicsDebug(physics, game.scene, params);

  const player = new Player(game.camera, physics, canvas);
  // Later frame owners return the traveller first (LIFO); retire its latest controller, rather than the boot capsule.
  game.levelScope.onDispose(() => { player.motor.dispose(); });
  if (inputContexts.length > 0) installGameplayInput(player, canvas, game.levelScope, inputContexts);
  app.input.buffer.ms = level.fight.input?.bufferMs ?? 120;
  player.coyoteMs = level.fight.input?.coyoteMs ?? 100;
  setActiveBodies(new Bodies(physics, player.position, BODY_CAP[TIER]).attach(game)); // PHYSICS P7: items as bodies (src/shared/engine/physics/bodies.ts), stepped in the fixed phases, capped near the player
  // the registry's listeners: a registered piece is drawn, collides, and (until P4 / P3) lends the player its floor
  const registry = app.registry; // the one list of built things: scene, physics, floors and Explore's catalog read it
  const moving: (() => void)[] = []; // pieces that follow a moving object (the boat): posed every fixed step
  game.levelScope.onDispose(() => { moving.length = 0; player.platforms.length = 0; registry.pieces.length = 0; registry.picks.length = 0; registry.sets.length = 0; });
  registry.onAdd((piece) => {
    if (piece.object) game.scene.add(piece.object);
    const added = addPiece(physics, piece);
    // SF57: a piece built under an owner shorter than the level (a borrowed home's entry) takes its mover and floor with it
    const owner = enteredOwner(), shorter = owner !== null && owner !== game.levelScope ? owner : null;
    if (added.body || piece.active) {
      const sync = added.sync;
      moving.push(sync);
      shorter?.onDispose(() => { const i = moving.indexOf(sync); if (i !== -1) moving.splice(i, 1); });
    }
    const floor = piece.floor;
    if (floor && piece.solidFloor !== true) {
      player.platforms.push(floor);
      shorter?.onDispose(() => { const i = player.platforms.indexOf(floor); if (i !== -1) player.platforms.splice(i, 1); });
    }
  });
  // the forest's trunks (Nalati's spruces; none on the island). A forest its shard's tree model draws: the model's (E315)
  if (forest.trees.length > 0 && forest.drawer === 'self') withOwner(game.levelScope, () => registry.add({ id: 'forest', name: 'Forest', category: 'nature', file: 'src/client/engine/world/forest/Forest.ts', surface: 'wood', colliders: forest.colliderDescs() }));
  // the shard's paths as walkways where they cross ground steeper than the motor climbs (PHYSICS P4) — laid by main.ts
  // once the builders have registered their decks, so no board pokes up through one (`addPathWalkways`)
  player.spawn(num('x', def.spawn.x), num('z', def.spawn.z), num('yaw', def.spawn.yaw), def.spawn.y);
  player.pitch = num('pitch', 0);

  const tour = new Tour(game.camera, level.ground.terrain === undefined && level.ground.structures !== undefined
    ? terrainFieldFor(level.ground, level.id).heightAt : Heightfield.heightAt);
  tour.active = params.has('tour');
  const world: World = { game, sky, terrain, forest, player, physics, registry, tour, params, num, freeCamera: false };
  game.levelScope.listen(canvas, 'click', () => { if (!params.has('nolock') && !world.freeCamera) player.lock(); }); // Explore's free camera keeps the cursor
  // frame phases (Game.ts): input → fixed steps (pre: move the boxes, step: advance the world, post: the player's move) → update → late
  const playing = () => !tour.active && !world.freeCamera;
  const deviceMode = (): 'frame' | 'live' | 'paused' => app.clock.mode === 'capture' ? 'frame'
    : playing() && player.link !== null && app.state === 'play' && !app.clock.paused && document.visibilityState !== 'hidden' ? 'live' : 'paused';
  // labels name them in error reports; `true` = core: the world step and the player's move can't be switched off (src/shared/engine/core/faults.ts)
  player.inputService = app.input; player.traversalEvents = app.events;
  app.addSystem({ id: 'engine.input.collect', phase: 'input', before: ['engine.player.input'], run: () => { if (playing()) player.collectActions(); else app.input.clear(); } }, game.levelScope);
  game.onInput((dt) => { if (playing()) player.input(dt); }, 'engine.player.input');
  game.onFixed('pre', () => { for (const m of moving) m(); }, 'physics.movers');
  game.onFixed('step', () => { world.physics.step(); }, 'physics.step', true);
  const heldDevice = () => player.sampleHeldCommand();
  game.onFixed('post', (dt) => { const on = playing(); player.setBodyEnabled(on); player.link?.driveDevice?.(deviceMode, heldDevice); if (on) player.stepDevice(dt); }, 'player.step', true);
  game.onUpdate((dt) => {
    if (tour.active) { tour.setTime(tour.time); player.position.copy(game.camera.position); player.position.y -= 1.7; }
    else if (!world.freeCamera) player.update(dt, game.alpha);
    forest.update(dt, world.freeCamera ? game.camera.position : player.position); // Explore's free camera: LOD around the eye, not the parked player
  }, 'player.update');
  installCrashFlag(game, params); // ?crash=system|fatal|window|boot — dev builds / unlocked reviewers only (E133)
  game.levelScope.expose(window, '__hf', Heightfield);
  game.beginLevelSystems();
  return world;
}
