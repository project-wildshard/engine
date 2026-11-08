
import type { ShardManifest, FieldModelsContext } from '../shard/manifest';
import type { Game } from '@wildshard/engine/core/Game';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { Player } from '@wildshard/engine/player/Player';
import type { Forest } from '@wildshard/engine/world/forest/Forest';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import type { Water as DeclarationWater } from '@wildshard/engine/world/pond';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { Loading } from '@wildshard/engine/ui/Loading';
import type { LevelAudioProfile } from '@wildshard/engine/audio/levelAudio';

import type { Preload, AudioBanks } from '@wildshard/engine/boot/extras';
import type { getMusicStyle } from '@wildshard/engine/ui/Settings';
import type { LoadStage } from '../shard/load';
import type { StagedBoot, SessionState, KitPorts } from './context';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { INPUT_CONTEXTS } from '../inputContexts';
import { type Audio as LevelAudio, Audio } from '@wildshard/engine/audio/Audio';
import { type Music as LevelMusic, Music } from '@wildshard/engine/audio/Music';
import type { LevelContext } from '@wildshard/engine/level/context';
import { toLevelSpec } from '../shard/spec';
import { gridLevel } from '../../../shared/game/grid/pageMode';
import { gridPageShellLevel } from '../grid/pageShell';
import type * as THREE from 'three';
import type { dataStage } from './data';
import { asShell } from '@wildshard/engine/app/ownership';
import { app } from '@wildshard/engine/app/runtime';
import { markBootContextLost, markBootHandledError } from '@wildshard/engine/boot/bootTrace';
import { macrotask, type Plan, type StepRunner } from '@wildshard/engine/boot/plan';
import { bootstrap, type World } from '@wildshard/engine/core/bootstrap';
import { earlyProgramsOn, queueBakedPrograms, type BakedPrograms } from '@wildshard/engine/boot/earlyPrograms';
import { TIER } from '@wildshard/engine/core/tier';
import { cachedResourceAllocations } from '@wildshard/engine/render/textureBytes';
import { shardPackBase } from '../boot/spawnDownload';
import { installEntrySockets } from '@wildshard/engine/physics/entrySockets';
import { installPagePathRamps } from '../shardfile/pagePreparation';
import { showError } from '@wildshard/engine/ui/ErrorModal';
import { Boundary } from '@wildshard/engine/world/Boundary';
import { hasPond } from '@wildshard/engine/world/Heightfield';
import { Horizon } from '@wildshard/engine/world/Horizon';
import { HorizonMatte } from '@wildshard/engine/world/HorizonMatte';

/** DL10: the shard's recorded entry programs (`scripts/bake-entry-programs.mjs`), or null when it has none. */
async function bakedEntryPrograms(slug: string): Promise<BakedPrograms | null> {
  const base = shardPackBase(slug);
  if (base === null) return null;
  const response = await fetch(new URL(`programs/${slug}.json`, base));
  if (!response.ok) return null;
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('version' in data) || data.version !== 2 || !('lines' in data) || !('shaders' in data)
    || !('programs' in data)) return null;
  const { lines, shaders, programs } = data;
  const indices = (row: unknown): row is number[] => Array.isArray(row) && row.every((at: unknown) => typeof at === 'number');
  if (!Array.isArray(lines) || !lines.every((line: unknown): line is string => typeof line === 'string')) return null;
  if (!Array.isArray(shaders) || !shaders.every(indices)) return null;
  if (!Array.isArray(programs) || !programs.every((p: unknown): p is [number, number] => indices(p) && p.length === 2)) return null;
  return { version: 2, lines, shaders, programs };
}

async function buildWorld(ctx: Awaited<ReturnType<typeof dataStage>>, level: LevelContext | undefined) : Promise<{ world: World & { chunk: ShardManifest; }; game: Game; sky: SkyRig; player: Player; forest: Forest; params: URLSearchParams; chunk: ShardManifest; registry: WorldRegistry; fragileBoot: boolean; failGpuBoot: (reason: string, stack?: string) => void; onBootContextLost: (event: Event) => void; nolock: boolean; viewer: () => THREE.Vector3; edgeDressing: { boundary: Boundary; water: DeclarationWater | null; streams: null; horizon: Horizon; horizonReady: Promise<void>; }; boundary: Boundary; water: DeclarationWater | null; horizon: Horizon; interactables: Interactable[]; props: null; prepareAudio: () => { audio: LevelAudio; music: LevelMusic; }; disableBootGpuGuard: () => void; level: LevelContext | undefined; loading: Loading; audioProfile: LevelAudioProfile | undefined; files: Readonly<Record<"sky" | "baked" | "terrain" | "trees" | "physics" | "cabins" | "props" | "art" | "music" | "sfx", readonly string[]>>; plan: Plan<"audio" | "sky" | "terrain" | "physics" | "cabins" | "props" | "renderer" | "cards" | "forest" | "edge" | "grass" | "animals" | "weapon" | "assembly" | "menu" | "shaders" | "firstFrame">; step: StepRunner; menuLoad: Preload<void> | null; audioLoad: Preload<AudioBanks> | null; deferredAudio: (Preload<void> & { readonly style: ReturnType<typeof getMusicStyle>; decode: () => Promise<AudioBanks>; }) | null; fieldModels: Promise<(ctx: FieldModelsContext) => void> | null; manifest: ShardManifest; slug: string; stage: LoadStage; boot: StagedBoot; session: SessionState; kit: KitPorts; product: ShardProduct; }> {
  const { manifest, boot, session, audioProfile, plan, step, product } = ctx;

  const selected = { ...manifest, spawn: boot.handoff?.arrive ?? manifest.spawn };
  // DL10 (Debug 'Early shader compile'): the entry's recorded programs start linking from the renderer step (bootstrap)
  if (earlyProgramsOn()) queueBakedPrograms(bakedEntryPrograms(ctx.slug));
  const world = Object.assign(await bootstrap(step, session.ownedGridHome ? gridPageShellLevel(selected) : gridLevel(toLevelSpec(selected, product)), INPUT_CONTEXTS), { chunk: manifest });
  const { game, sky, player, forest, params, chunk, registry } = world;
  session.residency?.bindAssets(app.assets, game.engineScope, session.ownedGridHome ? null : game.levelScope, () => app.levelScope, cachedResourceAllocations);
  if (!session.ownedGridHome) installEntrySockets(world.physics, game.levelScope, [{ x: 0, z: 0 }]);
  app.params = params;
  boot.runtime.world = world; boot.runtime.step = step;
  if (level !== undefined) game.rootScene.add(level.root);
  // Fragile phone builds need a GPU guard before normal in-game recovery is installed.
  const fragileBoot = TIER === 'phone' && manifest.boot?.phone?.fragile === true;
  let bootGpuGuardActive = fragileBoot;
  let bootGpuExit = false;
  const failGpuBoot = (reason: string, stack = ''): void => {
    if (!bootGpuGuardActive || bootGpuExit) return;
    bootGpuExit = true;
    session.fatalShown = true;
    game.hold = true;
    if (/context lost/i.test(reason)) markBootContextLost();
    else markBootHandledError();
    plan.fail(`GPU BOOT FAILED · ${reason}`.slice(0, 300));
    showError(`${manifest.name} GPU boot failed: ${reason}`, stack);
  };
  const onBootContextLost = (event: Event): void => {
    event.preventDefault();
    failGpuBoot('WebGL context lost during loading');
  };
  if (fragileBoot) game.levelScope.listen(game.canvas, 'webglcontextlost', onBootContextLost);
  const nolock = params.has('nolock');
  // what the view-dependent layers (ground cover, grass, mist) fill around: the player, or Explore's free camera (E66)
  const viewer = (): THREE.Vector3 => (world.freeCamera ? game.camera.position : player.position);
  boot.runtime.viewer = viewer;
  // a structure-first shard (ShardManifest.ground.structures, Nine Dragon Stack): no ground cover / cabins / props / walkways — its world is built in the props step
  const built = game.level.ground.structures;

  // ── world dressing ──
  const edgeDressing = await step('edge', async () => {
    const boundary = new Boundary(sky, game.level.boundary).build();
    game.rootScene.add(boundary.group);
    await macrotask(); // boundary · water · horizon each in its own task
    const water = hasPond() ? new (await import('@wildshard/engine/world/pond')).Water(sky, forest.trees, { ...(chunk.pondClip === undefined ? {} : { clip: chunk.pondClip }), ...(chunk.pondLilyExclusions === undefined ? {} : { lilyExclusions: chunk.pondLilyExclusions }) }).build() : null;
    if (water) game.rootScene.add(water.group);
    // PH-L9: Pine Hollow's creek, waterfall, plunge foam and spray (two draws; they run on the wind clock)
    const streams = null;
    await macrotask();
    // the booted spec's declared horizon only (G552: no engine default); in the grid it yields to the cube (gridLevel, G99)
    const horizon = new Horizon(sky).build(game.level);
    game.rootScene.add(horizon.group);
    // the painted 360° horizon (X4): far sea stacks, islands and cloud banks on the sea, day + night; the paintings load after boot
    const seaBody = app.world.water.sea; // registered at level.data, before the edge step
    const matte = seaBody !== null ? new HorizonMatte(sky, seaBody.level).build() : null;
    let horizonReady: Promise<void> = Promise.resolve();
    if (matte?.mesh) {
      game.rootScene.add(matte.mesh);
      game.onUpdate((dt) => { matte.update(dt, game.camera, sky.dayNight?.night ?? 0); }, 'main.2');
      // DL17 (G1000): the paintings are level content: they load now, beside the rest of the level, and the reveal waits
      // for them (finish.ts), shown whole at control instead of fading in after it
      horizonReady = matte.load(undefined, true);
    }
    // the painted land horizon (Pine Hollow, PH-L5) likewise: its phone pack was read 0.2 s after control (DL17)
    const painted = horizon.painted;
    if (painted !== null) horizonReady = Promise.all([horizonReady, painted.load(true)]).then(() => undefined);
    // observed now (sp-x6): an early refusal must not surface as an unhandled rejection before the loader's own failure;
    // the reveal's join (finish.ts) still awaits, and fails on, this same promise
    void horizonReady.catch(() => undefined);
    return { boundary, water, streams, horizon, horizonReady };
  });
  const { boundary, water, horizon } = edgeDressing;
  boot.runtime.horizonVeil = horizon.painted?.veil ?? null;
  // Deferred plugin paths run after their decks; ordinary worlds are ready now.
  if (chunk.ground.paths !== 'plugin' && built === undefined) installPagePathRamps(registry, { id: 'paths', name: 'Paths' });

  if (manifest.boot?.stagedWorld !== true) {
    await step('grass', () => undefined);
    await step('cabins', () => undefined);
  }
  const props = null;
  // Plugins need their audio service in kit; legacy levels retain their original allocation order.
  let preparedAudio: { audio: LevelAudio; music: LevelMusic } | undefined;
  const prepareAudio = (): { audio: LevelAudio; music: LevelMusic } => {
    if (preparedAudio) return preparedAudio;
    const audio = new Audio(manifest.audio);
    // headless tests / captures: never make a sound (the master builds at gain 0 while muted; reading it here built the
    // AudioContext during load, G325)
    if (params.has('mute')) audio.muted = true;
    // the Wildshard theme (project/archive/2026-09-23-music.md): the same score as the trailer, adaptive in play — menu / calm / alert / combat / underwater + stings
    // the page's one score (the shell's): built with the first shard, routed through the running shard's master (Music.attach)
    const music = session.music ?? asShell(() => new Music(audio));
    session.music = music;
    music.attach(audio);
    music.setState({ mode: 'menu', intensity: 0, underwater: false });
    audio.music = music;
    audio.listenerPosition = player.position;
    app.audio = audio;
    preparedAudio = { audio, music };
    return preparedAudio;
  };
  const disableBootGpuGuard = (): void => { bootGpuGuardActive = false; };
  if (audioProfile) prepareAudio();
  return { ...ctx, world, game, sky, player, forest, params, chunk, registry, fragileBoot, failGpuBoot, onBootContextLost, nolock, viewer, edgeDressing, boundary, water, horizon,
    get interactables() { return boot.runtime.interactables; }, props, prepareAudio, disableBootGpuGuard, level };
}

export const worldStage: typeof buildWorld = buildWorld;
