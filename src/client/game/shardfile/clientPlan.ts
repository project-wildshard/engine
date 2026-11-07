import * as v from 'valibot';
import { QuestRuntimeFileSchema } from '@wildshard/format/questRuntime';
import { checkClientPlanModules } from './clientModules';
import { entryOwner as declaredOwner } from '../../../shared/game/shardfile/entryOwners';
import { prepareClientReturnModules } from './clientReturnModules';
import { preflightIslandBook } from './islandBook';
import { enteredAdventurePersistence } from '../../../shared/game/quest/chapterBindings';
import { timeClientPreparation } from './preparationTiming';
import { runtimeLookMaterials } from './runtimeProduct';
import { hasLentLook, lendLooks } from './lentLooks';
import { TIER } from '@wildshard/engine/core/tier';
import { Color } from 'three';
import { syncPainterlySun,updatePainterly,setPainterlyLook,painterlyUniforms } from '@wildshard/engine/world/painterly';
import { wind } from '@wildshard/engine/world/steppeWind';
import { windUniforms } from '@wildshard/engine/world/TreeFactory';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { clientNativeBook } from './clientNativeBook';
import type { PlatformSectionName } from '@wildshard/format/sections';
import { constructionCheckpoint } from './constructionCheckpoint';
import type { Scope } from '@wildshard/engine/app/scope';
import { parseClientPlan, type ClientFeatureKind, type ClientFeatureRow } from '@wildshard/format/clientPlan';
import { clientOwnershipRules } from '@wildshard/format/clientOwnership';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import type { ShardContext } from '../plugin/context';
import { ProductError, type ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { clientSceneHandles, publishClientSceneHandles } from './clientSceneHandles';
import { installEnteredRuntimeService, retainsRuntimeServices } from '../shard/retainedHooks';

export type ClientPhase = 'world' | 'world-bindings' | 'kit' | 'prepare-play' | 'play';
interface ClientFeature {
  readonly phase: ClientPhase;
  readonly phaseFor?: (row: ClientFeatureRow) => ClientPhase;
  readonly rank: number;
  readonly rankFor?: (row: ClientFeatureRow) => number;
  readonly lifetime: 'resident' | 'entered';
  readonly sections: readonly PlatformSectionName[];
  /** Native metadata can precede the original visual constructor without loading its looks. */
  readonly needsWorldLooks?: false;
  readonly install: (ctx: ShardContext, row: ClientFeatureRow, resident: Scope) => Promise<void> | void;
  readonly play?: { readonly rank: number; readonly install: ClientFeature['install'] };
  readonly world?: { readonly rank: number; readonly when: (row: ClientFeatureRow) => boolean; readonly install: ClientFeature['install'] };
  readonly preparePlay?: { readonly rank: number; readonly install: ClientFeature['install']; readonly when?: (row: ClientFeatureRow) => boolean };
}
/** Keep optional feature graphs cold until their original ordered phase.
 * The module can finish loading after eviction; refuse before invoking it. */
function loadFeature(load: () => Promise<ClientFeature['install']>): ClientFeature['install'] {
  return async (ctx, row, resident) => {
    const scope = ctx.scope, product = ctx.product, install = await load();
    if (ctx.scope !== scope || ctx.product !== product || scope.disposed || scope.disposing || resident.disposed || resident.disposing) throw new Error('Client feature owner is disposed');
    await install(ctx, row, resident);
  };
}
/** Compiled-in client-only registry. Adding a kind requires its strict format schema and a reviewed platform host. */
export const CLIENT_FEATURES: Readonly<Record<ClientFeatureKind, ClientFeature>> = {
  'content.catalogue': { phase: 'kit', rank: 15, lifetime: 'entered',
    // Item/quest/journal envelopes are root data; finishes are streamed separately.
    sections: ['held/finishes'], install: loadFeature(async () => (await import('./clientCatalogue')).installClientCatalogue) },
  'state.adventure': { phase: 'world', rank: 5, lifetime: 'entered', needsWorldLooks: false, sections: [], install: loadFeature(async () => (await import('../../../shared/game/quest/persistence')).installClientAdventurePersistence),
    preparePlay: { rank: -100, when: row => row.kind === 'state.adventure' && row.progress === true, install: (ctx, row) => {
      if (row.kind !== 'state.adventure' || row.progress !== true) throw new Error('Invalid adventure progress feature');
      const play = ctx.game.runtime?.play;
      if (play === undefined || play === null) throw new Error('Adventure progress requires its play owner');
      enteredAdventurePersistence(ctx.scope).bindProgress(play.progress);
    } } },
  'world.assembly': { phase: 'world', rank: 70, lifetime: 'entered', needsWorldLooks: false, sections: ['world/scenes'], install: async (ctx, row) => {
    if (row.kind !== 'world.assembly') throw new Error('Invalid world assembly feature');
    const { installClientWorldAssembly } = await import('./clientWorldAssembly');
    await installClientWorldAssembly(ctx, row);
  } },
  'world.meadow': { phase: 'world', rank: 46, lifetime: 'entered', sections: [], install: loadFeature(async () => (await import('./clientMeadow')).installClientMeadow) },
  // Construction and entered lending finish before these fixed owner bindings.
  // Rows cannot choose this boundary or move it after the shell captures hooks.
  'world.ambient-life': { phase: 'world-bindings', rank: 20, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'world.ambient-life') throw new Error('Invalid ambient life feature');
    const { installClientAmbientLife } = await import('./clientAmbientLife');
    await installClientAmbientLife(ctx, row);
  } },
  'world.updates': { phase: 'world-bindings', rank: -10, lifetime: 'entered', sections: ['look/toon'], install: async (ctx, row) => {
    if (row.kind !== 'world.updates') throw new Error('Invalid world updates feature');
    const { installWorldUpdates } = await import('./worldUpdates');
    installWorldUpdates(ctx, row.rows);
  } },
  'combat.targets': {phase:'world-bindings',rank:0,lifetime:'entered',sections:[],install:async(ctx,row)=>{
    if(row.kind!=='combat.targets')throw new Error('Invalid combat target feature');
    const {installCombatTargets}=await import('./clientTargets');installCombatTargets(ctx,row.rows,row.bindings);
  }},
  'world.runtime-hooks': { phase: 'world-bindings', rank: 0, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'world.runtime-hooks') throw new Error('Invalid runtime hooks feature');
    const { installClientRuntimeHooks } = await import('./clientRuntimeHooks');
    installClientRuntimeHooks(ctx, row);
  } },
  'world.movers': { phase: 'world-bindings', rank: 10, lifetime: 'entered', sections: ['world/movers'], install: async (ctx, row) => {
    if (row.kind !== 'world.movers') throw new Error('Invalid mover owners feature');
    const { installClientMoverOwners } = await import('./clientMoverOwners');
    await installClientMoverOwners(ctx, row);
  } },
  // G571: the declared forest page (world 30, after world.scenes; its play stage puts the cave's spots on the ranged page
  // before the weather (40) and the page's life (65) build, their order when a shard's plugin built them)
  'world.forest-page': { phase: 'world', rank: 30, lifetime: 'entered', sections: [],
    install: async (ctx, row) => {
      if (row.kind !== 'world.forest-page') throw new Error('Invalid forest page feature');
      const { installClientForestPage } = await import('./clientForestPage');
      await installClientForestPage(ctx, row);
    },
    play: { rank: 35, install: async (ctx, row) => {
      if (row.kind !== 'world.forest-page') throw new Error('Invalid forest page feature');
      const { enterClientForestPage } = await import('./clientForestPage');
      await enterClientForestPage(ctx, row);
    } } },
  'weather.forest': { phase: 'play', rank: 40, lifetime: 'entered', sections: [],
    install: async (ctx, row) => {
      if (row.kind !== 'weather.forest') throw new Error('Invalid forest weather feature');
      if (row.hud === true) {
        const play = ctx.game.runtime?.play;
        if (play === undefined || play === null) throw new Error('Weather HUD requires its play owner');
        ctx.on('weather.changed', state => { if (ctx.game.runtime?.play !== play) throw new Error('Weather HUD owner changed'); play.hud.setWeather(state); });
      }
      const { installClientForestWeather } = await import('./clientForestPage');
      await installClientForestWeather(ctx, row.file, undefined, row.owner);
    } },
  'page.life': { phase: 'play', rank: 65, lifetime: 'entered', sections: [],
    install: async (ctx, row) => {
      if (row.kind !== 'page.life') throw new Error('Invalid page life feature');
      const { installClientPageLife } = await import('./clientForestPage');
      await installClientPageLife(ctx, row);
    } },
  'held.ranged-page': { phase: 'world', rank: 60, lifetime: 'entered', sections: ['held/finishes'],
    install: async (ctx, row) => {
      if (row.kind !== 'held.ranged-page') throw new Error('Invalid ranged page feature');
      const { prepareRangedPage } = await import('../loadout/rangedPage');
      await prepareRangedPage(ctx, await ctx.product.json(row.file));
    }, preparePlay: { rank: 10, install: async (ctx, row) => {
      if (row.kind !== 'held.ranged-page') throw new Error('Invalid ranged page feature');
      const { installEntryRangedPage } = await import('./clientQuestComposition');
      await installEntryRangedPage(ctx, row);
    } } },
  'quest.views': { phase: 'play', rank: -30, lifetime: 'entered', sections: ['world/scenes'], install: async (ctx, row) => {
    if (row.kind !== 'quest.views') throw new Error('Invalid quest views feature');
    const { installEntryQuestViews } = await import('./clientQuestComposition');
    await installEntryQuestViews(ctx, row);
  } },
  'view.program': { phase: 'play', rank: -20, lifetime: 'entered', sections: ['view/modules'], install: async (ctx, row) => {
    if (row.kind !== 'view.program') throw new Error('Invalid view program feature');
    const { installViewProgram } = await import('./clientViewProgram');
    const live = (): void => { if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('View program owner has ended'); };
    live(); const bytes = await ctx.product.file(row.module); live();
    installViewProgram(ctx, row, bytes);
  } },
  'world.bind-sets': { phase: 'play', rank: -10, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'world.bind-sets') throw new Error('Invalid named-place binding feature');
    const { bindEnteredClientPlaceSets } = await import('./clientPlaceSets');
    await bindEnteredClientPlaceSets(ctx, row);
  } },
  'taming.entry': { phase: 'play', rank: 70, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'taming.entry') throw new Error('Invalid taming entry feature');
    const { installTamingEntry } = await import('./clientEntryBinds');
    installTamingEntry(ctx, row);
  } },
  'arena-room.entry': { phase: 'play', rank: 80, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'arena-room.entry') throw new Error('Invalid arena room entry feature');
    const { installArenaRoomEntry } = await import('./clientEntryBinds');
    installArenaRoomEntry(ctx, row);
  } },
  'elite.entry': { phase: 'play', rank: 100, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'elite.entry') throw new Error('Invalid elite entry feature');
    const { installClientEliteEntry } = await import('./clientEliteEntry');
    installClientEliteEntry(ctx, row);
  } },
  'quest.chapter-view': { phase: 'play', rank: 110, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'quest.chapter-view') throw new Error('Invalid chapter view feature');
    const { installEntryChapterView } = await import('./clientQuestComposition');
    await installEntryChapterView(ctx, row);
  } },
  'quest.continuation': { phase: 'play', rank: 0, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'quest.continuation') throw new Error('Invalid quest continuation feature');
    const { installQuestContinuationFile } = await import('../quest/continuation');
    await installQuestContinuationFile(ctx, row.file);
  } },
  'quest.world': { phase: 'prepare-play', rank: 15, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'quest.world') throw new Error('Invalid quest world feature');
    const { prepareQuestWorldEntry } = await import('./questWorld');
    await prepareQuestWorldEntry(ctx, row.file, row.ambient);
  } },
  'quest.reference': { phase: 'world', rank: 55, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'quest.reference') throw new Error('Invalid quest reference feature');
    const { installEntryQuestReference } = await import('./clientQuestComposition');
    installEntryQuestReference(ctx, row.id);
  } },
  'quest.composition': { phase: 'prepare-play', rank: 20, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'quest.composition') throw new Error('Invalid quest composition feature');
    const { installEntryQuestComposition } = await import('./clientQuestComposition');
    await installEntryQuestComposition(ctx, row);
  } },
  'quest.spawns': { phase: 'prepare-play', rank: 30, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'quest.spawns') throw new Error('Invalid quest spawns feature');
    const { installDeclaredQuestSpawns } = await import('../quest/chapterDirector');
    const { publishEntryOwner } = await import('../../../shared/game/shardfile/entryOwners');
    v.parse(QuestRuntimeFileSchema,row.source);
    publishEntryOwner(ctx.scope, 'quest-spawns', row.id, await installDeclaredQuestSpawns(ctx, { ...row, source: row.source }));
  } },
  'held.claims.prepare': { phase: 'kit', phaseFor: row => row.kind === 'held.claims.prepare' && row.source !== undefined ? 'world-bindings' : 'kit', rank: -30, lifetime: 'entered', sections: ['held/arms'], install: async (ctx, row) => {
    if (row.kind !== 'held.claims.prepare') throw new Error('Invalid claims preparation feature');
    const { prepareHeldClaimsEntry } = await import('./heldClaimsEntry');
    await prepareHeldClaimsEntry(ctx, row.id, row.source);
  } },
  'population.hull-book': { phase: 'kit', rank: -25, lifetime: 'entered', sections: ['actors/species-programs', 'explore/catalogue'], install: async ctx => {
    const { prepareDeclaredHullBookKit } = await import('../models/socketRigCreature');
    await prepareDeclaredHullBookKit(ctx);
  } },
  'population.product-creatures': { phase: 'kit', rank: -20, lifetime: 'entered', sections: ['actors/species-programs'], install: async ctx => {
    const { installProductCreatures } = await import('../population/productCreatures');
    if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Client feature owner is disposed');
    await installProductCreatures(ctx);
  } },
  'held.claims.install': { phase: 'kit', rank: -10, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'held.claims.install') throw new Error('Invalid claims installation feature');
    const { installHeldClaimsEntry } = await import('./heldClaimsEntry');
    installHeldClaimsEntry(ctx, row.claims, row.preparation);
  } },
  'held.claims.enter': { phase: 'play', rank: -50, lifetime: 'entered', sections: ['held/arms'], install: async (ctx, row) => {
    if (row.kind !== 'held.claims.enter') throw new Error('Invalid held claims entry feature');
    const { entryOwner } = await import('../../../shared/game/shardfile/entryOwners');
    await entryOwner(ctx.scope, 'claims', row.claims).enter(ctx, { grapple: row.grapple });
  } },
  'portal.ride': { phase: 'play', rank: -40, lifetime: 'entered', sections: [], install: async (ctx, row) => {
    if (row.kind !== 'portal.ride') throw new Error('Invalid portal ride feature');
    const { installDeclaredPortalRide } = await import('./portalRideBinding');
    await installDeclaredPortalRide(ctx, row.rows);
  } },
  'world.paths': { phase: 'kit', rank: 0, lifetime: 'entered', sections: [], install: loadFeature(async () => (await import('./pagePreparation')).installClientPathRamps) },
  'riding.session': { phase: 'world', rank: 49, lifetime: 'entered', sections: [], install: loadFeature(async () => (await import('../riding/client')).installClientRiding) },
  'stealth.entry': { phase: 'prepare-play', rank: 0, lifetime: 'entered', sections: ['player/stealth'], install: async (ctx, row) => {
    if (row.kind !== 'stealth.entry') throw new Error('Invalid stealth entry feature');
    const { installClientStealthEntry } = await import('./clientStealthEntry');
    installClientStealthEntry(ctx, row);
  }, world: { rank: 0, when: () => true, install: loadFeature(async () => (await import('./clientStealthEntry')).prepareClientStealthEntry) } },
  'elite.construct': { phase: 'world', rank: 75, lifetime: 'entered', needsWorldLooks: false, sections: [], install: async (ctx, row) => {
    if (row.kind !== 'elite.construct') throw new Error('Invalid elite construction feature');
    const { installClientEliteConstruction } = await import('./clientEliteConstruction');
    await installClientEliteConstruction(ctx, row);
  } },
  'timed.encounters': { phase: 'world', rank: 80, lifetime: 'entered', needsWorldLooks: false, sections: [], install: async (ctx, row) => {
    if (row.kind !== 'timed.encounters') throw new Error('Invalid timed encounter feature');
    const { installClientTimedEncounters } = await import('./clientTimedEncounters');
    await installClientTimedEncounters(ctx, row);
  } },
  'practice.course': { phase: 'play', rank: 100, lifetime: 'entered', sections: [], install: loadFeature(async () => (await import('../practice/registration')).installPracticeCourse) },
  'population.wildlife': { phase: 'world', rank: 49, lifetime: 'entered', sections: [], install: loadFeature(async () => (await import('../population/wildlifeFeature')).installClientWildlife),
    play: { rank: 120, install: async (ctx, row) => {
      if (row.kind !== 'population.wildlife') throw new Error('Invalid wildlife publication');
      if (row.publish === undefined) return;
      const { clientWildlife } = await import('../../../shared/game/population/wildlifeOwner');
      const runtime = ctx.game.runtime;
      if (ctx.scope.disposed || ctx.scope.disposing || runtime === undefined || runtime.world === null || runtime.step === null || runtime.play === null) throw new Error('Wildlife publication requires its entered world and play owner');
      const wildlife = clientWildlife(ctx); if (wildlife === null) throw new Error('Wildlife has not been built');
      ctx.scope.expose(runtime.objects, row.publish, wildlife);
    } } },
  'world.water': {phase:'world',rank:42,lifetime:'entered',sections:[],install: loadFeature(async () => (await import('./clientWaterSurfaces')).installClientWaterSurfaces)},
  'world.baked': { phase: 'world', rank: 43, lifetime: 'resident', sections: [], install: loadFeature(async () => (await import('./bakedTiles')).installClientBakedTiles) },
  'audio.scene': {phase:'world',rank:48,lifetime:'entered',sections:[],install: loadFeature(async () => (await import('../audio/sceneDirector')).installClientAudioScene),play:{rank:30,install: loadFeature(async () => (await import('../audio/sceneDirector')).enterClientAudioScene)}},
  'look.painterly': {phase:'world',rank:10,lifetime:'entered',sections:[],install:(ctx,row)=>{
    if(row.kind!=='look.painterly')throw new Error('Invalid painterly feature');
    const world=ctx.game.runtime?.world;if(world===undefined||world===null)throw new Error('Painterly look requires its world');
    const apply=()=>{syncPainterlySun(world.sky);setPainterlyLook({shadeTint:new Color(...row.shadeTint),rimColor:new Color(...row.rimColor),wind:row.wind});};
    if(retainsRuntimeServices(ctx))installEnteredRuntimeService(ctx,apply);else apply();
    ctx.system({id:'client.painterly',phase:'update',after:['main.world'],before:['engine.creatures.update'],run:dt=>{updatePainterly(dt);painterlyUniforms.uPWind.value.set(wind.dirX,wind.dirZ,windUniforms.uWindStrength.value);}});
  }},
  'world.sets': {phase:'world',rank:47,lifetime:'entered',sections:[],install: loadFeature(async () => (await import('./clientPlaceSets')).installClientPlaceSets)},
  'strings.register': { phase: 'world', rank: 0, lifetime: 'entered', sections: ['ui/strings'], needsWorldLooks: false,
    install: ctx => {
      const rows = ctx.product.section('ui/strings');
      if (!retainsRuntimeServices(ctx)) { ctx.strings(rows); return; }
      installEnteredRuntimeService(ctx, scope => { ctx.app.levelRegistrations.strings(rows, scope); });
    } },
  'world.dressing': {phase:'world',rank:45,lifetime:'entered',sections:['world/scenes'],install:loadFeature(async()=>{
    const {SceneDressing}=await import('./sceneDressing');
    return async(ctx)=>{
      const rows=ctx.product.section('world/scenes').dressing;if(rows===undefined)throw new Error('Dressing feature requires its scene rows');
      await SceneDressing.install(ctx,await ctx.product.json<unknown>(rows[TIER]));
    };
  })},
  'world.scenes': { phase: 'world', rank: 20, lifetime: 'resident', sections: ['world/scenes'],
    install: loadFeature(async () => {
      const [{ installWorldScenes }, { noteTileBytes, residentTiles, followResidentTiles, productTileRing, cameraCone }, { StreamingCamera }] = await Promise.all([import('./worldScenes'), import('./tileDriver'), import('./streamingView')]);
      return async (ctx, _row, resident) => {
        const value = await installWorldScenes(ctx, ctx.product.section('world/scenes'), resident);
        publishClientSceneHandles(ctx.product, resident, value);
        // LD4 / CO6: a scene's tiled parts (T3) draw nothing until a tile driver attaches their tiles. The world.assembly and
        // forest-page hosts drive their own scenes; a plan with neither (Far Reach) left these hidden: its trees, decorative
        // isles and islet bodies drew no instances. Drive them here as those hosts do (spawn ring first, then the player).
        if (ctx.product.section('client/plan').features.some(row => row.kind === 'world.assembly' || row.kind === 'world.forest-page')) return;
        const source = ctx.product.shardfile, world = ctx.game.runtime?.world;
        if (value.tiled().length === 0) return;
        if (world === undefined || world === null) throw new Error('Tiled world scenes require a world');
        noteTileBytes(resident, source.tiles); await residentTiles(resident, value.tiled(), source.spawn, source.entryways, productTileRing(source));
        const camera = new StreamingCamera(ctx.root, () => world.game.camera);
        const follow = followResidentTiles(resident, () => world.player.position, () => cameraCone(world.game.camera), () => camera.read());
        if (follow !== null) ctx.system({ id: 'client.world.scene-tiles', phase: 'update', run: () => { follow(); } });
      };
    }) },
  'light.emitters': { phase: 'world', rank: 30, lifetime: 'resident', sections: ['world/scenes'],
    install: loadFeature(async () => {
      const { installLightEmitters } = await import('./lightEmitters');
      return async (ctx, row, resident) => {
        if (row.kind !== 'light.emitters') throw new Error('Invalid emitter feature');
        await installLightEmitters(ctx, row.rows, clientSceneHandles(ctx.product, resident), resident);
      };
    }) },
  'motion.channels': { phase: 'world', rank: 40, lifetime: 'entered', sections: ['world/scenes'],
    install: loadFeature(async () => {
      const { installSceneMotion } = await import('./sceneMotion');
      return (ctx, row, resident) => {
        if (row.kind !== 'motion.channels') throw new Error('Invalid scene motion feature');
        installSceneMotion(ctx, row.rows, clientSceneHandles(ctx.product, resident));
      };
    }) },
  // after quest.chapter-view: the finds borrow the quest it binds
  'bag.finds': {phase:'play',rank:120,lifetime:'entered',sections:[],install: loadFeature(async () => (await import('./clientFinds')).installClientFinds)},
  'held.cosmetics': {phase:'kit',rank:30,lifetime:'entered',sections:['held/finishes'],install: loadFeature(async () => (await import('./clientCosmeticFinishes')).installClientCosmeticFinishes)},
  'held.ranged-feel': {phase:'play',rank:30,lifetime:'entered',sections:[],install: loadFeature(async () => (await import('../plugin/heldEquipment')).installHeldRangedFeel)},
  'held.melee': { phase: 'kit', rank: 10, lifetime: 'entered', sections: ['look/painted'], install: loadFeature(async () => (await import('./clientHeldMelee')).installClientHeldMelee),
    play: { rank: 20, install: loadFeature(async () => (await import('./clientHeldMelee')).enterClientHeldMelee) } },
  'player.enter': { phase: 'world', rank: 50, lifetime: 'entered', sections: [], install: loadFeature(async () => (await import('./clientPlayerEnter')).installClientPlayerEnter),
    play: { rank: 25, install: loadFeature(async () => (await import('./clientPlayerEnter')).enterClientPlayer) } },
  'species.program': { phase: 'kit', rank: 20, rankFor: row => row.kind === 'species.program' && row.catalogue !== undefined ? -40 : 20, lifetime: 'entered', needsWorldLooks: false, sections: ['actors/species-programs', 'sim/scripts', 'sim/runtime-plan'], install: loadFeature(async () => (await import('./clientSpeciesProgram')).installClientSpeciesProgram),
    world: { rank: 10, when: row => row.kind === 'species.program' && row.catalogue !== undefined, install: loadFeature(async () => (await import('./clientSpeciesProgram')).prepareClientSpeciesCatalogue) } },
  'quest.page': { phase: 'play', rank: 10, lifetime: 'entered', sections: ['world/scenes', 'world/targets', 'look/painted'], install: loadFeature(async () => (await import('./clientQuestPage')).installClientQuestPage),
    play: { rank: 80, install: loadFeature(async () => (await import('./clientQuestPage')).finishClientQuestPage) } },
  'boss.spawned': { phase: 'play', rank: 50, lifetime: 'entered', sections: ['sim/runtime-plan'], install: loadFeature(async () => (await import('./clientBossFight')).installClientBossFight) },
  'population.homes': { phase: 'play', rank: 60, lifetime: 'entered', sections: ['sim/runtime-plan', 'sim/scripts'], install: loadFeature(async () => (await import('./clientPopulation')).installClientPopulation) },
  'boss.held': { phase: 'play', rank: 70, lifetime: 'entered', sections: ['sim/runtime-plan'], install: loadFeature(async () => (await import('./clientBossFight')).installClientBossFight) },
  'boss.telegraph': { phase: 'play', rank: 75, lifetime: 'entered', sections: ['sim/runtime-plan', 'actors/strikes'], install: loadFeature(async () => (await import('./clientBossTelegraph')).installClientBossTelegraph) },
  'weather.fields': { phase: 'play', rank: 40, lifetime: 'entered', sections: [],
    install: loadFeature(async () => {
      const { installWeatherFields } = await import('./weatherFields');
      return (ctx, row) => {
        if (row.kind !== 'weather.fields') throw new Error('Invalid weather feature');
        installWeatherFields(ctx, row.rows, row.quest);
      };
    }) },
  'audio.cues': { phase: 'world', rank: 48, lifetime: 'entered', sections: ['world/scenes'],
    install: loadFeature(async () => {
      const { installClientCues } = await import('./clientCues');
      return (ctx, row) => { if (row.kind === 'audio.cues' && row.stage === 'world') installClientCues(ctx, row); };
    }),
    play: { rank: 30, install: loadFeature(async () => {
      const { installClientCues } = await import('./clientCues');
      return (ctx, row) => { if (row.kind === 'audio.cues' && row.stage !== 'world') installClientCues(ctx, row); };
    }) } },
  'fx.trail': { phase: 'play', rank: 90, lifetime: 'entered', sections: ['world/scenes'], install: loadFeature(async () => (await import('./clientTrails')).installClientTrails) },
  'debug.expose': { phase: 'play', phaseFor: row => row.kind === 'debug.expose' && row.source?.kind !== 'world-weather' && (row.objects !== undefined || row.source !== undefined) ? 'world-bindings' : 'play', rank: 100, lifetime: 'entered', sections: [], install: (ctx, row, resident) => {
    if (row.kind !== 'debug.expose' || ctx.scope.disposed || ctx.scope.disposing || ctx.game.runtime === undefined) throw new Error('Client debug feature requires its runtime');
    if (row.source !== undefined) {
      const source=row.source;
      if(source.kind==='dressing')return loadFeature(async()=>{
        const {SceneDressing}=await import('./sceneDressing');
        return context=>{context.debug.expose(row.name,SceneDressing.current(context));};
      })(ctx,row,resident);
      const value=source.kind==='runtime-object'?ctx.game.runtime.objects[source.id]:source.kind==='timed-riders'?declaredOwner(ctx.scope,'timed-encounters',source.owner).riders:source.kind==='arena-room'?declaredOwner(ctx.scope,'arena-room',source.owner):declaredOwner(ctx.scope,'world-weather',source.owner);
      if(value===undefined)throw new Error('Missing declared debug source');ctx.debug.expose(row.name,value);
    } else if (row.objects !== undefined) {
      const runtime = ctx.game.runtime, objects = runtime.objects;
      ctx.debug.expose(row.name, Object.defineProperties({}, Object.fromEntries(row.objects.map(key => [key, {enumerable: true, get: () => {
        if (ctx.game.runtime !== runtime || runtime.objects !== objects) throw new Error('Debug object owner changed'); return objects[key];
      }}]))));
    } else if (hasDeclaredClientPage(ctx.product.shardfile)) {
      const book = clientNativeBook(ctx); ctx.debug.expose(row.name, Object.assign(book, { stage: book.capture }));
    } else ctx.debug.expose(row.name, ctx.game.runtime);
  } },
};
export interface AdmittedClientPlan { readonly features: readonly ClientFeatureRow[] }
/** Validate the whole plan and all required sections before the first feature can mutate the page. */
export function admitClientPlan(input: unknown, product: ShardProduct): AdmittedClientPlan {
  try {
    const plan = parseClientPlan(input);
    if(plan.features.some(row=>row.kind==='held.claims.install')&&plan.features.some(row=>row.kind==='held.melee'||row.kind==='held.ranged-page'))throw new Error('Held claims require their sole native equipment builder');
    for (const row of plan.features) if (row.kind === 'world.assembly') preflightIslandBook(product, row);
    for (const row of plan.features) {
      if (row.kind === 'held.claims.enter') {
        if (!plan.features.some(owner => owner.kind === 'held.claims.prepare' && owner.id === row.claims)
          || !plan.features.some(owner => owner.kind === 'held.claims.install' && owner.claims === row.claims && owner.preparation!=='world')) throw new Error('Held play entry requires matching declared claims');
        if (![row.grapple.presentation].every(file => product.hasFile(file))) throw new Error('Held play entry requires its admitted grapple files');
        if (!product.shardfile.items.rows.some(item => item.id === row.grapple.item && item.kind === 'tool')) throw new Error('Held play entry requires its declared tool');
      }
    }
    if (plan.features.some(row => row.kind === 'population.hull-book')) {
      if (plan.features.some(row => row.kind === 'population.product-creatures')) throw new Error('Hull book kit cannot duplicate product creatures');
      // These existing admitted services retain their wire during entry migration.
      for (const name of ['look/hull-book', 'held/equipment'] as const) {
        if (!product.has(name)) throw new Error('Hull book kit requires its admitted legacy owners');
        product.section(name);
      }
      const { slug: identity } = product;
      const cards = product.section('explore/catalogue').entries.flatMap(row => row.kind === 'socket-creature' ? [row.rows] : []);
      if (cards.length === 0 || new Set(cards.map(card => card.model.id)).size !== cards.length
        || cards.some(card => card.product !== identity || !product.hasFile(card.sockets))) throw new Error('Hull book kit requires its unique admitted socket cards');
    }
    const prepare = plan.features.find(row => row.kind === 'held.claims.prepare'), install = plan.features.find(row => row.kind === 'held.claims.install');
    if(install?.preparation==='world'){
      if(prepare!==undefined&&(prepare.source===undefined||prepare.id!==install.claims))throw new Error('World-prepared held claims cannot repeat kit preparation');
    } else if((prepare!==undefined||install!==undefined)&&(prepare===undefined||install===undefined||prepare.id!==install.claims))throw new Error('Held claims require one matching preparation and installation');
    if(install!==undefined&&install.preparation!=='world')product.section('held/arms');
    if(prepare?.source!==undefined&&(install?.preparation!=='world'||!product.hasFile(prepare.source.slots)||!product.hasFile(prepare.source.library)))throw new Error('Held slot preparation requires its declared world sources');
    if (plan.features.some(row => row.kind === 'population.product-creatures')) {
      if (!product.hasFile('actors/creature-install.json')) throw new Error('Product creatures require their admitted install rows');
      // Compatibility owners already live in the admitted product; they are not new client feature schemas.
      for (const name of ['economy/loot', 'look/hull-book'] as const) {
        if (!product.has(name)) throw new Error('Product creatures require their admitted legacy owners');
        product.section(name);
      }
    }
    for (const row of plan.features) if (row.kind === 'world.bind-sets') {
      if (!plan.features.some(feature => feature.kind === 'world.sets')) throw new Error('Named-place binding requires its declared sets');
      if (row.quest !== undefined && !plan.features.some(feature => feature.kind === 'quest.composition' && feature.id === row.quest)) throw new Error('Named-place binding requires its declared quest');
    }
    const sections = new Map(outputDescriptor(product.shardfile)?.sections);
    for (const name of ['world/scenes', 'actors/species-programs', 'sim/runtime-plan', 'sim/scripts', 'look/painted'] as const)
      if (product.has(name)) sections.set(name, product.section(name));
    sections.set('client/plan', plan);
    const errors = clientOwnershipRules(product.shardfile, sections); if (errors.length > 0) throw new Error(errors.join('; '));
    if (plan.features.some(row => row.kind === 'light.emitters') && !plan.features.some(row => row.kind === 'world.scenes')) throw new Error('Emitters require the scene feature');
    if (plan.features.some(row => row.kind === 'motion.channels') && !plan.features.some(row => row.kind === 'world.scenes')) throw new Error('Motion requires the scene feature');
    if(plan.features.some(row=>row.kind==='held.cosmetics')&&product.section('held/finishes').cosmetics===undefined)throw new Error('Cosmetic feature requires declared finishes');
    if(plan.features.some(row=>row.kind==='held.ranged-feel')&&!product.shardfile.items.rows.some(row=>row.kind==='weapon'&&row.equipment?.rangedFeel!==undefined))throw new Error('Ranged feel requires admitted equipment feedback rows');
    for (const row of plan.features) if (row.kind === 'world.baked') for (const baked of row.rows) {
      const files = [baked.glb, ...baked.lightmaps.flatMap(map => [map.source.phone, map.source.desktop]), ...(baked.instances === null ? [] : [baked.instances.table, baked.instances.protos, baked.instances.plan.phone.source, baked.instances.plan.desktop.source])];
      const looks = [baked.look, ...Object.values(baked.instances?.looks ?? {}).map(slot => slot.look)];
      if (files.some(file => 'file' in file && !product.hasFile(file.file)) || looks.some(look => product.shardfile.look.materials[look] === undefined)) throw new Error('Baked tiles require their admitted files and look');
    }
    for(const row of plan.features)if(row.kind==='world.water')for(const water of row.rows){
      if(product.shardfile.look.materials[water.surface.look]===undefined)throw new Error('Water requires its declared look');
      if('geometry' in water){if(!product.hasFile(water.geometry)||water.surface.floor!==undefined)throw new Error('Water requires declared geometry and look without floor textures');continue;}
      // O7: a drawn row's files are admitted product files or immutable assets; its floor, dry rects and foam fit its surface
      const draw=water.draw,files=[draw.grid.phone,draw.grid.desktop,...(draw.floor===undefined?[]:[draw.floor])];
      if(files.some(file=>'file' in file&&!product.hasFile(file.file)))throw new Error('Water requires its admitted draw files');
      if((water.surface.floor===undefined)!==(draw.floor===undefined)||(draw.foam.length>0&&draw.floor===undefined))throw new Error('Water floor and foam require a floored surface and its baked floor');
      if(draw.dry.length>(water.surface.dry?.slots??0))throw new Error('Water clips more dry rectangles than its surface has slots');
    }
    for (const row of plan.features) if (row.kind === 'view.program' && !product.hasFile(row.module)) throw new Error('View program requires its admitted module');
    for (const row of plan.features) if (row.kind === 'quest.views' && !product.hasFile(row.file)) throw new Error('Quest views require their admitted data file');
    for (const row of plan.features) if (row.kind === 'world.ambient-life' && !product.hasFile(row.file)) throw new Error('Ambient life requires its admitted data file');
    for (const row of plan.features) if (row.kind === 'held.ranged-page' && !product.hasFile(row.file)) throw new Error('Ranged page requires its admitted data file');
    // G571: a forest page, its cave, weather and life name admitted files; a cave's spots and the life name a declared ranged page
    for (const row of plan.features) {
      if ((row.kind === 'world.forest-page' || row.kind === 'weather.forest' || row.kind === 'page.life') && !product.hasFile(row.file)) throw new Error('Forest page features require their admitted data files');
      if (row.kind === 'world.forest-page' && row.cave !== undefined && !product.hasFile(row.cave.file)) throw new Error('Forest page cave requires its admitted data file');
      const ranged = row.kind === 'page.life' ? row.ranged : row.kind === 'world.forest-page' ? row.cave?.spots?.ranged : undefined;
      if (ranged !== undefined && !plan.features.some(feature => feature.kind === 'held.ranged-page')) throw new Error('Forest page ambience requires a ranged page');
    }
    for (const row of plan.features) if (row.kind === 'species.program' && row.catalogue !== undefined
      && (!product.hasFile(row.catalogue.actors) || !product.hasFile(row.catalogue.looks))) throw new Error('Species catalogue requires its admitted files');
    for (const row of plan.features) if ((row.kind === 'state.adventure' || row.kind === 'world.meadow') && !product.hasFile(row.file)) throw new Error('World services require their admitted data files');
    for (const row of plan.features) if (row.kind === 'riding.session' && (!product.hasFile(row.file) || !plan.features.some(feature => feature.kind === 'population.wildlife'))) throw new Error('Riding requires its admitted session file and wildlife feature');
    for (const row of plan.features) if (row.kind === 'population.wildlife' && [row.file, row.crowd.json, row.crowd.binary].some(file => !product.hasFile(file))) throw new Error('Wildlife requires its admitted population and crowd files');
    if(plan.features.some(row=>row.kind==='audio.scene')&&product.shardfile.audio.scene===undefined&&(product.shardfile.audio.sceneFile===undefined||!product.hasFile(product.shardfile.audio.sceneFile)))throw new Error('Audio scene requires its declared profile');
    if(plan.features.some(row=>row.kind==='world.dressing')){const rows=product.section('world/scenes').dressing;if(rows===undefined||!product.hasFile(rows.phone)||!product.hasFile(rows.desktop))throw new Error('Dressing requires both declared tier files');}
    if (plan.features.some(row => row.kind === 'weather.fields' && !product.shardfile.quests.quests.some(quest => quest.id === row.quest))) throw new Error('Weather fields require their declared quest');
    for(const row of plan.features)if(row.kind==='bag.finds'&&(!product.hasFile(row.file)||!product.shardfile.quests.quests.some(quest=>quest.id===row.quest)))throw new Error('Finds require their admitted file and quest');
    for (const row of plan.features) {
      if (row.kind === 'quest.chapter-view' && (!product.hasFile(row.chapterView) || !product.hasFile(row.story))) throw new Error('Chapter view requires its admitted content and story files');
      if (row.kind === 'quest.continuation' && !product.hasFile(row.file)) throw new Error('Quest continuation requires its admitted data file');
      if ((row.kind === 'quest.world' || row.kind === 'quest.composition' || row.kind === 'held.ranged-page') && !product.hasFile(row.file)) throw new Error('Entry preparation requires its admitted data file');
      if (row.kind === 'quest.composition') {
        if (row.figures !== undefined && [row.figures.file, 'people/catalogue.json', 'models/world-scenes.json'].some(file => !product.hasFile(file))) throw new Error('Quest figures require their admitted data and catalogues');
        if (row.reference !== undefined && !plan.features.some(feature => feature.kind === 'quest.reference' && feature.id === row.reference)) throw new Error('Quest composition requires its declared reference');
      }
      if (row.kind === 'quest.reference' && !plan.features.some(feature => feature.kind === 'quest.composition' && feature.reference === row.id)) throw new Error('Quest reference requires its declared composition');
      if (row.kind === 'quest.spawns') {
        v.parse(QuestRuntimeFileSchema,row.source);
        if (!product.hasFile(row.source)) throw new Error('Quest spawns require their admitted runtime file');
        if (!plan.features.some(owner => owner.kind === 'quest.composition' && owner.id === row.quest && owner.equipment?.animals === row.animals && owner.equipment.sounds === row.sounds)) throw new Error('Quest spawns require their declared composition owners');
      }
      const required = row.kind === 'world.updates' && !row.rows.some(update => update.kind === 'toon-look') ? [] : row.kind === 'held.claims.prepare' && row.source !== undefined ? [] : row.kind === 'species.program' && row.catalogue !== undefined ? ['look/hull-book'] as const : row.kind === 'content.catalogue' && !(row.finishes || row.effects.includes('finishes')) ? [] : CLIENT_FEATURES[row.kind].sections;
      for (const name of required) {
        if (!product.has(name)) throw new Error(`Missing feature section ${name}`);
        product.section(name); // A listed stream section is not an admitted boot dependency.
      }
    }
    checkClientPlanModules(plan);
    return { features: plan.features };
  } catch (error) { throw new ProductError(product.slug, 'client/plan', 'schema', error instanceof Error ? error.message : 'Invalid client plan'); }
}
const productPlans = new WeakMap<ShardProduct, AdmittedClientPlan>();
/** Capture one fully checked, detached immutable plan for this admitted product.
 * Runtime phases share this authority; arbitrary inputs still use admitClientPlan.
 * A replacement product owns a fresh admission even when its slug is unchanged. */
export function admittedProductClientPlan(product: ShardProduct): AdmittedClientPlan {
  const known = productPlans.get(product);
  if (known !== undefined) return known;
  const admitted = Object.freeze(admitClientPlan(product.section('client/plan'), product));
  productPlans.set(product, admitted);
  return admitted;
}
// Open arenas bind before rooms, independent of the product's feature order.
const phaseKey=(row:ClientFeatureRow):string=>row.kind==='debug.expose'?row.name:row.kind==='arena-room.entry'?`${row.kind}:${row.equipment===undefined?1:0}:${row.owner}`:row.kind;
/** Run a platform-ordered phase with bounded frame-budget pauses. Resident scene construction is cached by its host. */
export async function installClientPhase(ctx: ShardContext, plan: AdmittedClientPlan, phase: ClientPhase, resident: Scope, lifetime?: 'resident' | 'entered'): Promise<void> {
  if(lifetime!=='resident'&&(phase==='world'||phase==='kit'))await prepareClientReturnModules(ctx);
  const rows = plan.features.flatMap(row => {
    const feature = CLIENT_FEATURES[row.kind];
    if (lifetime !== undefined && feature.lifetime !== lifetime) return [];
    return [...((feature.phaseFor?.(row) ?? feature.phase) === phase ? [{ row, rank: feature.rankFor?.(row) ?? feature.rank, install: feature.install }] : []),
      ...(phase === 'world' && feature.world?.when(row) === true ? [{ row, ...feature.world }] : []),
      ...(phase === 'play' && feature.play !== undefined ? [{ row, ...feature.play }] : []),
      ...(phase === 'prepare-play' && feature.preparePlay !== undefined && (feature.preparePlay.when?.(row) ?? true) ? [{ row, ...feature.preparePlay }] : [])];
  }).sort((a, b) => a.rank - b.rank || phaseKey(a.row).localeCompare(phaseKey(b.row)));
  const live = (): void => {
    if (ctx.scope.disposed || ctx.scope.disposing || resident.disposed || resident.disposing) throw new Error('Client feature owner is disposed');
  };
  // The platform's look phase precedes every entered world step, including
  // trusted runtimes whose data client intentionally skips presentation. A
  // metadata-only phase leaves look construction to its original native owner.
  if (phase === 'world' && lifetime !== 'resident' && rows.some(({ row }) => CLIENT_FEATURES[row.kind].needsWorldLooks !== false)) {
    live();
    const missing = Object.keys(ctx.product.shardfile.look.materials).filter(id => !hasLentLook(id));
    if (missing.length > 0) await timeClientPreparation(ctx.product.slug, 'world.looks', async () => {
      lendLooks(ctx.scope, await runtimeLookMaterials(ctx, ctx.product.shardfile, true, missing));
    });
  }
  for (const { row, install } of rows) {
    live();
    await timeClientPreparation(ctx.product.slug, `${phase}.${row.kind}`, () => install(ctx, row, resident));
    // A completed install may already have yielded through reads/decodes.
    // Keep the shared frame budget, not a mandatory turn per tiny feature.
    const pause = constructionCheckpoint(ctx.scope);
    if (pause !== undefined) await pause;
    live();
  }
}
