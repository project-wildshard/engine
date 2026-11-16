import { bindResidentTileEntry } from '../shardfile/tileEntry';
import {bindEquipmentActors} from '../loadout/actors';
import { freezeParkedMatrices } from '@wildshard/engine/render/precompile';
import { timeClientPreparation } from '../shardfile/preparationTiming';
import { isDev } from '@wildshard/engine/core/devMode';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { clientHomeBytes } from '../shardfile/clientResidency';
import { Object3D, Vector3, type Texture } from 'three';
import { ownSceneTree } from '@wildshard/engine/app/sceneOwnership';
import type { DisposeStep, Scope } from '@wildshard/engine/app/scope';
import type { Game } from '@wildshard/engine/core/Game';
import { bindConstructionEnvironment, ownedFacade, ownerTask, withOwner } from '@wildshard/engine/app/ownership';
import { createLevelInstallation } from '@wildshard/engine/level/installation';
import { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import { startViewmodelTextures } from '@wildshard/engine/combat/view/ranged';
import { authoredTargets } from '@wildshard/engine/combat/targets';
import type { RowBodies, RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { SkinDef } from '@wildshard/engine/player/Skins';
import type { PlayerFrameQueries } from '@wildshard/engine/player/Player';
import { gridCreatureConstraint } from '@wildshard/engine/physics/gridBorders';
import { shardContext, type ShardContext } from "../plugin/context";
import type { ShardManifest } from '../shard/manifest';
import type { ShardPlayHost, ShardRuntime } from '../../../shared/game/shard/runtime';
import type { ShardWorld } from '../../../server/game/shard/world';
import type { HybridResident } from '../shardfile/hybrid';
import type { AdmittedFolder } from '../shardfile/folder';
import { admittedRuntimeFolder, shardFolderFromAdmission } from '../shardfile/runtimeFolder';
import type { GridCell } from '../../../shared/game/grid/assembly';
import { enteredFullMap, shiftedFullMap, shiftedMinimap } from './mapFrame';
import type { ResidencyAllocator, ResidencyLease } from '../../../shared/game/grid/allocator';
import type { LiveGridRegion } from './live';
import type { RegionShell } from './regionShell';
import type { GridLoadout } from '../../../shared/game/grid/wallet';
import { runtimeAccountedBytes, type RuntimeCost } from '@wildshard/format/runtimeCost';
import { createRegionalView, type RegionalView } from './regionalView';
import { installEnteredRuntimeService } from "../shard/retainedHooks";
import { Progress } from '../Progress';
import { Inventory } from '../Inventory';
import { ownedSave } from '../../../shared/game/saves';
import { readOnlySave, wirePage } from '../shardfile/wirePage';
import { Owned } from '../../../shared/game/loot/Owned';
import type { EnteredEquipment } from './enteredEquipment';
import { SkinLocker } from '../cosmetics/locker';
import { coverRuntimeAssets } from './assetResidency';
import { FrameCamera } from '@wildshard/engine/world/frameCamera';
import { pacedResolve } from '@wildshard/engine/core/workSlice';

function isSceneNode(value: unknown): value is Object3D { return value instanceof Object3D; }

function sameMeasurement(a: RuntimeCost, b: RuntimeCost): boolean {
  return (['webContentMB', 'glMB', 'engineBaseMB', 'residentBaseMB', 'rev', 'device', 'evidence'] as const).every(key => a[key] === b[key]);
}

/**
 * A transitional region pays for its whole opaque runtime. The first-party manifest and admitted declaration must
 * share the reviewed measurement and its images-first provenance; an empty declarative sim is never its estimate.
 * The selected image path uses its separate images-first measurement when declared. The caller reserves these bytes
 * through the page's ordinary allocator before constructing the regional shell.
 */
export function regionalRuntimeAccountedBytes(admitted: Pick<AdmittedFolder, 'source'>, manifest: Pick<ShardManifest, 'slug' | 'runtimeCost'>, textureMode?: 'img' | 'ktx2'): number {
  const { source } = admitted;
  const { slug: declaredIdentity } = source.identity, { slug: registeredIdentity } = manifest;
  if (declaredIdentity !== registeredIdentity) throw new Error('Regional runtime identity differs from its trusted manifest');
  if (hasDeclaredClientPage(source)) return clientHomeBytes(source.budgets, textureMode);
  const declared = source.runtime?.cost, measured = manifest.runtimeCost;
  if (declared === undefined || measured === undefined) throw new Error('Regional runtime requires reviewed whole-runtime measurements');
  const bytes = runtimeAccountedBytes(declared);
  runtimeAccountedBytes(measured);
  if (!sameMeasurement(declared, measured) || (declared.imagesFirst === undefined) !== (measured.imagesFirst === undefined)
    || !sameMeasurement(declared.imagesFirst ?? declared, measured.imagesFirst ?? measured)) throw new Error('Regional runtime measurement differs from its trusted manifest');
  return textureMode === 'img' ? runtimeAccountedBytes(declared.imagesFirst ?? declared) : bytes;
}

/** Existing page services lent to a regional shell; it never constructs another renderer, player or input loop. */
export interface RegionalRuntimePage {
  /** Stable page controls delegate to the entered kit; absent for ordinary borrowed-home pages. */
  readonly equipment?: EnteredEquipment;
  readonly world: ShardWorld;
  readonly play: ShardPlayHost;
  readonly context: ShardContext;
}

/** One resolved texture policy shared by pre-allocation admission and the resident's builds/frames. */
export interface RegionalRuntimeTextures {
  readonly mode: 'img' | 'ktx2';
  readonly enter: () => () => void;
}

/** Fully admitted immutable content and the one page owner, supplied before any trusted gameplay hook executes. */
export interface RegionalRuntimeRequest {
  readonly cell: GridCell;
  /** Actual requested approach in destination cell metres; absent for non-crossing callers. */
  readonly entryPoint?: Readonly<{ x: number; z: number }>;
  readonly admitted: AdmittedFolder;
  readonly manifest: ShardManifest;
  readonly page: RegionalRuntimePage;
  /** Resolved before the whole-runtime claim; absent only in renderer-free compositions. */
  readonly textures?: RegionalRuntimeTextures;
  readonly allocator: ResidencyAllocator;
  /** Already reserved through the ordinary page allocator at the full measured runtime cost. */
  readonly claim: ResidencyLease;
  readonly scope: Scope;
}

/**
 * The view adapter owns the real region, including critical terrain/colliders and a registry whose additions target
 * its own Physics. Its resident context supplies regional sky/terrain/forest; afterWorld and afterKit finish the shell
 * stages under isolated construction bindings, including the real AnimalManager, equipment, inventory and progress
 * before trusted play. Entered services publish only when the prepared resident crosses into its cell.
 * The resident's scope owns disposal in dependency order. A synthetic empty host cannot stand in for this contract.
 */
export interface PreparedRegionalRuntime {
  readonly region: LiveGridRegion & { readonly host: RegionShell };
  readonly queries: PlayerFrameQueries;
  readonly resident: HybridResident;
  /** Scalar warm-up progress only when the page trace belongs to this exact destination root. */
  readonly warmPreparation?: Game['entryPreparation'];
  readonly loadout: GridLoadout;
  /** Flush authored runtime progress and its admitted continuation; false keeps the traveller in the source frame. */
  readonly checkpoint: () => boolean;
  /** The actual retained herd; callers expose it to aiming only while this runtime is ready and entered. */
  readonly aimAnimals: () => RowBodiesView['animals'];
  /** Its creature manager once built, where a row is drawn (J130). */
  readonly animals: () => RowBodiesView | null;
  /** This cell's item rows: a ranged row names the server's slot for it. */
  readonly items: Shardfile['items']['rows'];
  /** Its own scoped runtime's interact prompts (frame-local; emptied on entry, ended with the runtime); callers scan them
   *  only while this runtime is ready and entered (`enteredRuntime`). Empty before the runtime's context exists. */
  readonly interactables: () => readonly ShardRuntime['interactables'][number][];
  /** A destination built on the road stays parked (invisible) until its crossing commits: stop its subtree's
   *  per-frame matrix updates while it is hidden (they resume whenever it shows; sp-o5's freezeParkedMatrices). Once. */
  readonly park?: () => void;
  /** Actual actor-object provenance in the retained region; repeated IDs in parked neighbours grant no permission. */
  readonly combatActors: () => ReadonlyMap<ReturnType<RowBodiesView['animals'][number]['combatActor']>, Readonly<{ x: number; y: number; z: number }>>;
}

/** Trusted composition-root adapter. Whole-runtime admission precedes construction; entered services stay interior-only. */
export type RegionalRuntimeFactory = (request: RegionalRuntimeRequest) => Promise<PreparedRegionalRuntime>;

/**
 * Required engine binding: a real destination world, never the home's terrain, forest or AnimalManager. The engine
 * adapter supplies per-region Heightfield, level, baked terrain, navmesh and water bindings, restored on each leave.
 * Keeping this port required prevents an unfinished foundation from silently becoming an enterable empty world.
 */
export interface RegionalRuntimeFoundation {
  readonly region: LiveGridRegion & { readonly host: RegionShell };
  readonly ground: Pick<PlayerFrameQueries, 'heightAt' | 'waterSurfaceAt'>;
  /** The one renderer/player, but a regional scene facade, level scope, sky, terrain and forest. */
  readonly world: (view: RegionalView) => ShardWorld;
  readonly enter: (scope: Scope) => void;
  /** Bind reversible terrain/scene construction services without lights, entered systems or presentation. */
  readonly prepare?: (scope: Scope) => void;
  /** Private tile publication may overlap the world hook; it must finish before afterWorld or kit. */
  readonly renderReady?: Promise<void>;
  readonly afterWorld?: (context: ShardContext, world: ShardWorld) => Promise<void> | void;
  /** Build regional creatures after kit registrations; apply skins through the existing regional view adapter. */
  readonly afterKit: (context: ShardContext, world: ShardWorld) => Promise<{
    animals: RowBodies; wearSkin: (equipment: EquipmentService, skin: SkinDef) => void;
  }>;
  /** Real runtime continuation, local purse/ownership and encounter writes; refusal keeps the source frame. */
  readonly checkpoint: () => boolean;
  /** Bring every material the entered hooks added to the program it will draw with (the region look's patches) before
   *  the entered frame's shader warm-up compiles them; frames are held while the hooks install, so per-frame passes have
   *  not run on them yet. Includes the world-material preparation; callers need no separate sweep. */
  readonly beforeWarm?: () => Promise<void> | void;
  /** Finish the admitted sky and patch currently built world materials. Does not publish post passes or entered services. */
  readonly prepareWorldMaterials?: () => Promise<void> | void;
  /** Borrow the admitted regional scene's environment after its sky preparation.
   * The page facade may temporarily restore another scene while construction awaits. */
  readonly precompileEnvironment?: () => Texture | null;
}

/** Composition ports owned by the page root, with explicit absence until the engine's regional binding lands. */
export interface RegionalRuntimeFactoryPorts {
  readonly home: Readonly<{ x: number; z: number }>;
  readonly prepareFoundation?: (request: RegionalRuntimeRequest) => Promise<RegionalRuntimeFoundation>;
}

/** Compose the trusted regional stages without changing discovery, module admission or the fixed crossing driver. */
export function createRegionalRuntimeFactory(ports: RegionalRuntimeFactoryPorts): RegionalRuntimeFactory {
  return async request => {
    const declaration = request.admitted.source.runtime;
    if (declaration === null && !hasDeclaredClientPage(request.admitted.source)) throw new Error('Regional factory requires an admitted page owner');
    const bytes = regionalRuntimeAccountedBytes(request.admitted, request.manifest, request.textures?.mode);
    const { slug: cellIdentity } = request.cell, { slug: manifestIdentity } = request.manifest;
    if (cellIdentity !== manifestIdentity) throw new Error('Regional factory identity differs from its catalogue cell');
    const claim = request.allocator.entries().find(row => row.id === request.claim.id);
    if (claim === undefined || claim.owner !== request.cell.instance || claim.bytes !== bytes) {
      const actual = claim === undefined ? 'missing' : `${claim.owner}/${claim.bytes}`;
      throw new Error(`Regional factory requires its whole-runtime lease: ${request.claim.id}; expected ${request.cell.instance}/${bytes}, found ${actual}`);
    }
    const prepare = ports.prepareFoundation;
    if (prepare === undefined) throw new Error('Regional terrain/forest/animals binding is not prepared');
    const scope = request.scope.child(`grid.runtime:${request.cell.instance}`);
    let rendering: Promise<[PromiseSettledResult<void>]> | undefined;
    try {
      if (request.entryPoint !== undefined) bindResidentTileEntry(scope, request.entryPoint);
      const measured = request.textures?.mode === 'img' ? declaration?.cost?.imagesFirst ?? declaration?.cost : declaration?.cost;
      if (measured?.residentBaseMB !== undefined) {
        if (claim.id !== `sim:${request.cell.instance}`) throw new Error('Measured runtime coverage requires its own instance lease');
        request.allocator.markMeasuredPage(claim.id);
      }
      if (declaration !== null) coverRuntimeAssets(request.allocator, scope, request.claim);
      const foundation = await timeClientPreparation(request.cell.slug, 'native.foundation', () => prepare({ ...request, scope }));
      if (foundation.renderReady !== undefined) rendering = Promise.allSettled([foundation.renderReady]);
      if (scope.disposed) { if (rendering !== undefined) await rendering; foundation.region.dispose(); throw new Error('Regional runtime left during foundation admission'); }
      // G598: the region's world is the runtime's heaviest cleanup (Driftwood's whole resident scope, 22-28 ms in one step of
      // the Pine entry's retirement); a sliced retirement steps through its own cleanups in the same place
      const retireWorld = foundation.region.retire;
      if (retireWorld === undefined) scope.onDispose(foundation.region.dispose);
      else scope.onDisposeSteps(function* retireRegionWorld() { const steps = retireWorld(); while (steps.next().done !== true) yield; });
      const host = foundation.region.host;
      if (host.physics === request.page.world.physics) throw new Error('Regional factory requires an owned bodyless destination');
      // The page's own level scope owns its player services (loadout registers the equipment host there). Not
      // app.levelScope: with G580 T1 a build-ahead starts while another world is entered, whose scope that is, and its
      // services leave with it, so a construction lending from it lost the equipment host mid-build when the traveller
      // left the source (Sky Reach's held melee then refused its play stage).
      const app = request.page.context.app, parent = request.page.context.game.runtime, pageScope = request.page.world.game.levelScope;
      if (parent === undefined) throw new Error('Regional factory requires the page runtime');
      app.cpu.bind(scope, request.cell.instance);
      const view = createRegionalView({ cell: request.cell, home: ports.home, scene: request.page.world.game.rootScene,
        physics: host.physics, slot: app, assets: app.assets, allocator: request.allocator, claim: request.claim,
        scope, ground: foundation.ground, ownGround: request.manifest.cellGround === 'world',
        prepare: (node, root) => request.page.world.game.warmSceneRoots([node], () => !scope.disposed && node.parent !== null, root) });
      request.page.world.game.bindHiddenFrameRoot(scope, view.root);
      // D188 (Jake's G815): where the crossing reveals the player, in render space (the cell's root carries its origin);
      // the entered warm-up prepares what lies round it first (Game.warmEnteredFrame)
      const arrivalAt = (): Vector3 | undefined => {
        const entry = request.entryPoint; if (entry === undefined) return undefined;
        view.root.updateWorldMatrix(true, false);
        return view.root.localToWorld(new Vector3(entry.x, 0, entry.z));
      };
      const foundationWorld = foundation.world(view);
      // SF63: the herd's far cull reads the camera from the region's frame, where its animals stand (FrameCamera)
      const viewFromRoot = new FrameCamera(view.root);
      let enteredContext: ShardContext | null = null, anonymous = 0;
      const onUpdate: ShardWorld['game']['onUpdate'] = (run, label, core) => {
        if (enteredContext === null) throw new Error('Regional callback registered before its interior context');
        const id = `grid.runtime.${request.cell.instance}.callback.${label ?? String(anonymous++)}`;
        installEnteredRuntimeService(enteredContext, entry => { app.addContentSystem({ id, phase: 'update', run, ...(core === undefined ? {} : { core }) }, entry); });
      };
      // Content keeps the same renderer/player, but its stable scope and callback registration belong to this region.
      // The home Game's fields are never overwritten, even across yielded hooks or while this resident is parked.
      const game = new Proxy(foundationWorld.game, { get: (target, key, receiver) => {
        if (key === 'levelScope' || key === 'registrationScope') return scope;
        if (key === 'onUpdate') return onUpdate;
        const value: unknown = Reflect.get(target, key, receiver); return value;
      } });
      const world = { ...foundationWorld, game };
      if (world.physics !== host.physics || world.player !== request.page.world.player || world.game.renderer !== request.page.world.game.renderer) throw new Error('Regional world must keep the page renderer/player and destination physics');
      const skinRows: SkinDef[] = [];
      // SF63: the viewmodel sets this cell's weapons wear, drawn in a worker while its world and creatures build, as the
      // page boot does (session/data.ts). A grid entry never asked, so its weapons drew them on the main thread in kit
      // build (Pine: 24 ms of walnut alone on the desktop, several times that on the Simulator). Started on its admission.
      let viewmodelSets: Promise<void> | null = null;
      let localPlay: ShardPlayHost | null = null;
      let localRuntime: ShardRuntime | undefined;
      let stowed = false, restored = false, preparing = false;
      const checkpoint = (): boolean => {
        if (scope.disposed || localPlay === null || !restored) return false;
        // Attempt all owners even after a refusal; neither gameplay death/reset hooks nor a constant true is a save.
        const progress = localPlay.progress.checkpoint(), inventory = localPlay.inventory.checkpoint(), native = foundation.checkpoint();
        // On the wire the creatures are the server's rows: its session saves them, and this page's herd is empty.
        const logical = true;
        return progress && inventory && native && logical;
      };
      const resident: HybridResident = { instance: request.cell.instance, slug: request.cell.slug, declaration, firstParty: true,
        ...(foundation.renderReady === undefined ? {} : { renderReady: foundation.renderReady }),
        scope, product: shardFolderFromAdmission(request.admitted, scope), runtime: parent, retainRuntime: true, context: (owner, runtime) => {
          viewmodelSets ??= startViewmodelTextures(request.manifest.boot?.viewmodelSets ?? false);
          localRuntime = runtime; runtime.world = { ...world, registry: view.registry }; runtime.play = null;
          runtime.interactables.length = 0; runtime.overhead.length = 0;
          for (const key of Reflect.ownKeys(runtime.hooks)) Reflect.deleteProperty(runtime.hooks, key);
          for (const key of Reflect.ownKeys(runtime.objects)) Reflect.deleteProperty(runtime.objects, key);
          Reflect.deleteProperty(runtime, 'buildEquipment'); Reflect.deleteProperty(runtime, 'menu');
          // a named build step starts after the frame when the frame's build budget is already spent (pacedResolve)
          runtime.step = (key, work) => pacedResolve(undefined).then(() => timeClientPreparation(request.cell.slug, `runtime.${key}`, () => work(request.page.context.progress)));
          const installation = createLevelInstallation(app, owner, app.levelAdapters, () => request.page.context.progress);
          view.root.add(installation.context.root);
          const base = shardContext(installation.context, request.manifest, { ...request.page.context.game,
            runtime, shard: request.manifest, rows: new Map(), declaredAudio: request.admitted.source.audio },
            shardFolderFromAdmission(request.admitted, scope));
          const context: ShardContext = { ...base, rows: { ...base.rows, skin: values => {
            base.rows.skin(values);
            const list: readonly SkinDef[] = Array.isArray(values) ? values : [values as SkinDef];
            skinRows.push(...list);
          } } };
          const prepareFrame = foundation.prepare;
          let preparedModels: Object3D | null = null;
          let enteredWarm: Promise<void> | null = null;
          let equipmentReady: () => void = () => undefined;
          let contentReady: () => void = () => undefined;
          let forgetContent: () => void = () => undefined;
          return { ...installation, context,
            ...(prepareFrame === undefined ? {} : { prepareConstruction: () => {
              preparing = true;
              preparedModels = request.page.world.game.stageViewmodels(owner);
              // The resident can outlive a failed runtime child. Never restore that child's frame during its teardown.
              // Static world services belong to the resident, not its shorter-lived runtime child. Keep both in
              // the destination frame; page-owned callbacks still suspend it. The child below owns cancellation.
              const leave = bindConstructionEnvironment(scope, () => {
                const frameScope = owner.child('runtime.construction');
                try {
                  prepareFrame(frameScope); app.bindPlayerServices(pageScope, frameScope); view.prepare(frameScope);
                  return () => { frameScope.dispose(); };
                } catch (error) { frameScope.dispose(); throw error; }
              }, owner);
              return () => { try { leave(); } finally { preparing = false; } };
            } }),
            beforeWorld: entered => { enteredContext = entered; installEnteredRuntimeService(entered, entry => {
              foundation.enter(entry); app.bindPlayerServices(pageScope, entry); view.enter(entry);
              if (preparedModels !== null) {
                const models = preparedModels; models.visible = true;
                entry.onDispose(() => { models.visible = false; });
              }
              app.addContentSystem({ id: `grid.runtime.${request.cell.instance}.pieces`, phase: 'fixed.pre', run: () => { view.sync(); } }, entry);
            }); },
            afterWorld: async entered => {
              await foundation.afterWorld?.(entered, world);
              if (!preparing || foundation.prepareWorldMaterials === undefined) return;
              const equipment = new Promise<void>(resolve => { equipmentReady = resolve; });
              const content = new Promise<void>(resolve => { contentReady = resolve; });
              forgetContent = owner.capture('disposers', () => { equipmentReady(); contentReady(); });
              enteredWarm = request.page.world.game.warmEnteredFrame(owner, view.root, async (_prepareRoots, prepareWorldFrame) => {
                if (request.page.world.game.frameCount === 0 && foundation.precompileEnvironment !== undefined) {
                  // Initial boot lends the same completed world look to the
                  // existing census while kit/play build. Final whole-page
                  // preparation still follows both content rendezvous below.
                  await timeClientPreparation(request.cell.slug, 'entry.initial-look', () => foundation.beforeWarm !== undefined ? foundation.beforeWarm() : foundation.prepareWorldMaterials?.());
                  if (owner.disposed) throw new Error('Regional runtime left before its world warm-up');
                  await timeClientPreparation(request.cell.slug, 'entry.world-programs', () => prepareWorldFrame(foundation.precompileEnvironment?.()));
                }
                await timeClientPreparation(request.cell.slug, 'entry.wait-equipment', () => equipment);
                if (owner.disposed) throw new Error('Regional runtime left before its equipment warm-up');
                // PL6: the kit's creatures and the held view exist now; the same census takes them while play constructs
                // (at phone CPU 10x they were ~0.37 s of the boot shader step)
                if (request.page.world.game.frameCount === 0 && foundation.precompileEnvironment !== undefined) {
                  await timeClientPreparation(request.cell.slug, 'entry.kit-programs', () => prepareWorldFrame(foundation.precompileEnvironment?.()));
                  if (owner.disposed) throw new Error('Regional runtime left during its equipment warm-up');
                }
                await timeClientPreparation(request.cell.slug, 'entry.wait-content', () => content);
                if (owner.disposed) throw new Error('Regional runtime left before its final warm-up');
                // Late content gets the same final look and complete inventory;
                // an early census never publishes readiness or skips this fence.
                await timeClientPreparation(request.cell.slug, 'entry.final-look', () => foundation.beforeWarm !== undefined ? foundation.beforeWarm() : foundation.prepareWorldMaterials?.());
              }, arrivalAt());
              // Observe an early failure now; afterPlay still awaits the original rejection before readiness.
              void enteredWarm.catch(() => undefined);
            },
            afterKit: async entered => {
              const left = (): boolean => owner.disposed;
              const regional = await foundation.afterKit(entered, world);
              if (left()) throw new Error('Regional runtime left while building creatures');
              for (const animal of regional.animals.animals) animal.motionConstraint = hostConstraint(host, animal.dims.bodyRadius * animal.scale);
              runtime.hooks.animalsReady?.(regional.animals);
              await runtime.hooks.animalsBuilt?.(regional.animals);
              if (left()) throw new Error('Regional runtime left while building creatures');
              app.effects?.registerDefinitions(app.levelRegistrations.list('effect'));
              const targets = authoredTargets(app.events, regional.animals, () => null);
              bindEquipmentActors(targets,regional.animals,owner);
              const build = runtime.buildEquipment;
              if (build === undefined) throw new Error('Regional kit did not install its equipment factory');
              // a set that failed to arrive is drawn by its weapon as before: the head start is never a gate
              await viewmodelSets?.catch((error: unknown) => { console.warn(`[viewmodel textures] ${request.cell.instance}`, error); });
              if (left()) throw new Error('Regional runtime left while drawing its weapons\' textures');
              // G324: its own sword's viewmodel, as its standalone loadout hands it over (`ShardManifest.sword`): without it a
              // sword shard's weapon drew the engine's wooden sword in its cell (Nine Dragon's Jian)
              const sword = await ownerTask(owner, () => request.manifest.sword?.() ?? Promise.resolve(null));
              if (left()) throw new Error('Regional runtime left while loading its sword');
              const kit = await ownerTask(owner, () => build(targets, request.page.play.nolock, sword));
              if (left()) {
                for (const weapon of [kit.primary, kit.rifle, kit.secondary, ...(kit.extras ?? [])]) weapon?.dispose();
                throw new Error('Regional runtime left while building equipment');
              }
              // Kit models live under the shared camera, outside the regional scene subtree.
              // Their resident remains the sole GPU owner even while weapon.install detaches them on retirement.
              for (const weapon of new Set([kit.primary, kit.rifle, kit.secondary, ...(kit.extras ?? [])])) {
                if (weapon !== null && isSceneNode(weapon.model)) ownSceneTree(weapon.model, owner, app.assets);
              }
              withOwner(owner, () => {
                const weapons = new EquipmentService(kit.primary, { scope: owner, events: app.events,
                  input: { bind: (action, run, _scope, allowed) => { installEnteredRuntimeService(entered, entry => {
                    app.input.bind(action, run, entry, allowed ?? (() => weapons.enabled));
                  }); } }, ...(kit.order === undefined ? {} : { order: [...kit.order] }) });
                for (const weapon of [kit.rifle, kit.secondary, ...(kit.extras ?? [])]) if (weapon !== null) weapons.add(weapon, { locked: true });
                kit.install?.(weapons); app.registerEquipment(weapons, world.game.levelScope);
                if (preparing) { weapons.enabled = false; weapons.visible = false; weapons.stowed = true; }
                // J130: a cell's pack and gear are the server's, and its lines reach whichever cell the page has entered.
                const progress = new Progress(request.cell.instance), inventory = new Inventory(request.cell.instance), owned = new Owned(request.cell.instance, readOnlySave(ownedSave));
                inventory.writes = false;
                const skins = new SkinLocker(request.cell.instance, skinRows, request.admitted.source.migrations);
                wirePage.hold({ shard: request.cell.slug, inventory, gear: owned, finishes: skins }, owner);
                // SF57: the page's maps reach this resident's hooks through owner facades, so what its play registers on
                // them after an await (a quest card, its places, its marks) ends with the resident, not the page. (Not the
                // HUD or menu: other services key on their identity, e.g. bag tabs by menu.)
                const page = request.page.play;
                const residentOwned = <S>(service: S): S => (typeof service === 'object' && service !== null ? ownedFacade(owner, service) : service);
                // playtest round 3: what it registers in its own cell's metres moves into the maps' home frame
                const dx = request.cell.origin.x - ports.home.x, dz = request.cell.origin.z - ports.home.z;
                // G580 T1: the map's single slots are the entered resident's (enteredFullMap)
                localPlay = { ...page, fullMap: residentOwned(enteredFullMap(shiftedFullMap(page.fullMap, dx, dz), (install) => { installEnteredRuntimeService(entered, install); })),
                  ...(page.minimap === undefined ? {} : { minimap: page.minimap === null ? null : residentOwned(shiftedMinimap(page.minimap, dx, dz)) }),
                  animals: regional.animals, weapons, primary: kit.primary,
                  rifle: kit.rifle, secondary: kit.secondary, progress, inventory, owned, skins,
                  wearSkin: skin => { regional.wearSkin(weapons, skin); skins.wear(skin.weapon, skin.id); },
                  disposeRifleDrop: () => { runtime.hooks.disposeRifleDrop?.(); } };
                runtime.play = localPlay;
                installEnteredRuntimeService(entered, entry => {
                  app.addContentSystem({ id: `grid.runtime.${request.cell.instance}.animals`, phase: 'update', run: (dt, t) => {
                    // Native hitboxes/controllers are lazy, but belong to the parked resident rather than this entry.
                    withOwner(owner, () => regional.animals.update(dt, t, world.player.position, world.player.position, viewFromRoot.of(world.game.camera)));
                    localPlay?.progress.addPlay(dt);
                    weapons.update(dt, t);
                  } }, entry);
                  weapons.enabled = true; weapons.visible = !stowed; weapons.stowed = stowed;
                  entry.onDispose(() => { weapons.enabled = false; weapons.visible = false; weapons.adsHeld = false; weapons.altHeld = false; });
                });
              });
              equipmentReady();
            },
            afterPlay: async entered => {
              if (localPlay === null) throw new Error('Regional play services are not installed');
              // Trusted play can install encounter creatures; validate the complete herd before publishing readiness.

              const equipment = request.page.equipment, weapons = localPlay.weapons;
              await timeClientPreparation(request.cell.slug, 'entry.selection', () => weapons.settleSelection());
              if(owner.disposed||owner.disposing)throw new Error('Regional runtime left while preparing selected equipment');
              if (equipment !== undefined) installEnteredRuntimeService(entered, entry => { equipment.bind(weapons, entry); });
              for (const animal of localPlay.animals.animals) animal.motionConstraint = hostConstraint(host, animal.dims.bodyRadius * animal.scale);
              // G217 stays up until the actual page composer has warmed this newly entered world and kit.
              // Authored ctx.root is a sibling of the native scene under this view; its lights draw on entry too.
              // The region's own last preparation (its sky build, beforeWarm) runs inside the warm-up's time bound:
              // a stall there or in the warm-up is this admission's reported issue, never a silent hang (OP).
              contentReady(); forgetContent();
              await timeClientPreparation(request.cell.slug, 'entry.warm-tail', () => enteredWarm ?? request.page.world.game.warmEnteredFrame(owner, view.root, async () => {
                await foundation.beforeWarm?.();
              }, arrivalAt()));
              const trace = request.page.world.game.entryPreparation;
              if (isDev() && trace?.root === view.root.uuid) for (const [index, stage] of trace.stages.entries()) {
                // Existing completed spans explain the early compiler's tail
                // even before the boot publishes its public world handle.
                const name = `wildshard.prepare:${request.cell.slug}:entry.stage.${index}.${stage.phase}`;
                performance.clearMeasures(name);
                performance.measure(name, { start: stage.endAt - stage.elapsedMs, end: stage.endAt, detail: { units: stage.units } });
              }
              restored = true;
              // RP4: this cell's road variants (no PMREM), linked in play before the player can reach its edge
              const warmRoad = async (): Promise<void> => {
                try { await request.page.world.game.warmExteriorRoots(owner, [...view.root.children], () => !owner.disposed && !owner.disposing); }
                catch (error: unknown) { if (!owner.disposed && !owner.disposing) console.warn('[grid] road variant warm-up stopped', error); }
              };
              void warmRoad();
              // js-heap H6 for a grid region, as the solo page's finish.ts does: the entry has built and warmed everything
              // its admitted transport fed, so keep none of it (Nalati's 45 MB of product files stayed in a Simulator
              // interior's JS heap, T10). A later read rechecks the immutable cache or the network, as a released tile does;
              // a file with no reread stays.
              admittedRuntimeFolder(request.admitted.source.identity.slug)?.assets.releaseAll();
              void request.admitted.releaseTransport?.(request.admitted.assets.keys(), 'cache-or-fetch').catch(() => undefined);
            },
          };
        } };
      let parked = false;
      return { resident, get warmPreparation() {
        const trace = request.page.world.game.entryPreparation;
        return !scope.disposed && trace?.root === view.root.uuid ? trace : null;
      }, region: { ...foundation.region, dispose: () => { const nodes = treeNodes(view.root); scope.dispose(); const cut = severNodes(nodes); while (cut.next().done !== true) { /* whole */ } }, retire: () => retireRegion(view.root, scope),
        ghostRoots: [...foundation.region.ghostRoots ?? [], scope, view.root] }, queries: view.queries, checkpoint,
        aimAnimals: () => localPlay?.animals.animals ?? [], items: request.admitted.source.items.rows,
        animals: () => localPlay?.animals ?? null,
        interactables: () => localRuntime?.interactables ?? [],
        park: () => { if (!parked) { parked = true; freezeParkedMatrices(view.root); } },
        combatActors: () => new Map((localPlay?.animals.animals ?? []).map(animal => [animal.combatActor(), animal.position])),
        loadout: { checkpoint, stow: () => {
          stowed = true;
          if (localPlay !== null) { localPlay.weapons.stowed = true; localPlay.weapons.visible = false; localPlay.weapons.adsHeld = false; localPlay.weapons.altHeld = false; }
        }, interior: () => {
          stowed = false;
          if (localPlay !== null && localRuntime?.play === localPlay) { localPlay.weapons.stowed = false; localPlay.weapons.visible = true; }
        } } };
    } catch (error) {
      if (rendering !== undefined) await rendering;
      try { scope.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Regional admission and cleanup failed', { cause: cleanup }); }
      throw error;
    }
  };
}

/** O20: a left region's retirement in steps: its world stops drawing at once (no frame shows or re-uploads what a later
 *  step frees), then its scope's cleanups run as `Scope.disposeSteps` yields them. */
function* retireRegion(root: Object3D, scope: Scope): Generator<DisposeStep, void> {
  root.visible = false;
  // its nodes as it stood: its cleanups detach groups (a lamp group) before the cut, which must still reach them
  const nodes = treeNodes(root);
  yield* scope.disposeSteps();
  const cut = severNodes(nodes);
  while (cut.next().done !== true) yield { scope: scope.name, kind: 'nodes' };
}

/** every node of `root`'s tree, root first */
function treeNodes(root: Object3D): Object3D[] {
  const nodes: Object3D[] = [];
  root.traverse(node => { nodes.push(node); });
  return nodes;
}

/** Live P0 (Driftwood -> Sky Reach -> Driftwood on the phone): after a region's disposal, cut its nodes apart, a few
 *  hundred a step. One node something page-wide still names (a lamp a cached program's lighting reads, a hooked mesh)
 *  then keeps only itself, never the retired world under its parents. */
function* severNodes(nodes: readonly Object3D[]): Generator<undefined, void> {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node === undefined) continue;
    node.removeFromParent(); node.clear();
    if ((i + 1) % 256 === 0) yield;
  }
}

/** SF57: a creature's border constraint built outside the admission closure. V8 gives every closure of one scope that
 *  scope's single context, so an inline `() => host.physics` there held the whole runtime (its hooks, the shard's world)
 *  for as long as any creature kept its constraint. */
function hostConstraint(host: { readonly physics: Parameters<typeof gridCreatureConstraint>[0] extends () => infer P ? P : never }, radius: number): ReturnType<typeof gridCreatureConstraint> {
  return gridCreatureConstraint(() => host.physics, radius);
}
