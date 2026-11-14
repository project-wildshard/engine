// oxlint-disable unicorn/prefer-string-raw -- Its patterns are schema bytes, kept as sharddev wrote them.
import { SpeciesActorsFileSchema as SpeciesActorsDocumentSchema } from '@wildshard/format/speciesActorsFile';
import { QuestRuntimeDocumentSchema } from '@wildshard/format/questRuntime';
import { QuestStoryBindingsSchema } from '@wildshard/format/questStoryBindings';
import { QuestInteractionSourceSchema } from '@wildshard/format/questInteractionSource';
import { uniformIdentityTransforms } from '@wildshard/format/uniformRows';
import { HeldCueSchema, ArcWeaponItemSchema } from '@wildshard/format/heldMelee';
import { HeldJianDocumentSchema } from '@wildshard/format/heldJianDocument';
import { BladeDocumentSchema, PolearmDocumentSchema, HeldSlotsDocumentSchema } from '@wildshard/format/heldWeaponDocuments';
import { WaterWorldSchema } from '@wildshard/format/waterWorld';
import { ForestNativeInputsSchema } from '@wildshard/format/forestNativeInputs';
import { FindsCatalogueSchema } from '@wildshard/format/findsCatalogue';
import { WildlifePopulationSchema } from '@wildshard/format/wildlifePopulation';
import { ArenaRoomDocumentSchema, ArenaRoomDocumentRowsSchema, ArenaKingRowsSchema } from '@wildshard/format/arenaRoomDocument';
import { ReturnProgramDocumentSchema, ReturnProgramWireDocumentSchema } from '@wildshard/format/returnProgramDocument';
import { WeatherBundleSchema, WeatherDocumentSchema } from '@wildshard/format/weatherBundle';
import { WeatherEffectsSchema, WeatherGeometrySchema, WeatherGeometryDataSchema } from '@wildshard/format/weatherEffects';
import { RainPresentationSchema } from '@wildshard/format/rainPresentation';
import { ForestWeatherObservationSchema, RangedPageSchema } from '@wildshard/format/rangedPage';
import { PostGraphLookSchema, ScaledPostInputSchema, postGraphIdentityTransforms } from '@wildshard/format/postGraphLook';
import { PaintedAirSchema, PaintedGroundSchema, PaintedPanoramaSchema, PainterKeyLightSchema, PainterlyWorldSchema } from '@wildshard/format/paintedResources';
import { WorldScenePageSchema } from '@wildshard/format/worldScenePages';


import { SceneModelSourceSchema, SceneBakeSourceSchema } from '@wildshard/format/sceneSources';
import { PopulationFieldSchema, PopulationHabitatSchema } from '@wildshard/format/populationEnvironment';
import { FixedDrawRowsSchema } from '@wildshard/format/fixedDraws';
import { AudioSceneSchema } from '@wildshard/format/audioScene';
import { ForestGroundLayoutSchema, ForestPageSchema, LivingPageSitesSchema } from '@wildshard/format/forestPage';
import { CaveFileSchema, CaveInteriorSchema } from '@wildshard/format/caveInterior';
import { SceneBuffersSchema } from '@wildshard/format/sceneBuffers';
import { BakedPlacementPlanSchema, BakedTilesSchema } from '@wildshard/format/bakedTiles';
import { ClientRidingSessionSchema } from '@wildshard/format/riding';
import { ManifestMetadataSchema } from '@wildshard/format/minimap';
import { AdventurePersistenceSchema, HEADLESS_ASSEMBLY_JSON_SCHEMA, ReturnProgramSchema, PageReturnRowsSchema, QuestTraderSchema, PosedLibrarySchema } from '@wildshard/format/namedJsonContracts';
import {NativeQuestCompositionSchema,NativeQuestServiceSpotsSchema} from '@wildshard/format/nativeQuestComposition';
import { MixedPopulationSchema, PerchBodyFileSchema } from '@wildshard/format/mixedPopulation';
import { ResolvedIslandLibrarySchema, FixedGeometryGroupsSchema } from '@wildshard/format/islandLibrary';
import { CollectionDisplaysSchema } from '@wildshard/format/collectionDisplay';
import { SpecimenCatalogueSchema, PackedSpecimenSchema, SpecimenMaterialSchema, SpecimenAssetSchema, SpecimenBookSchema } from '@wildshard/format/specimenCatalogue';
import { BinarySourceSchema } from '@wildshard/format/binarySource';
import { NativeGroundFileSchema, nativeBodySchema, nativeColliderRecordSchema, nativeGroundRecordSchema, type NativeColliderRecord, type NativeArrayStorage } from '@wildshard/format/nativePhysics';
import { WorldAssemblySchema } from '@wildshard/format/worldAssembly';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { BowVariantSchema } from '@wildshard/format/bowVariantRows';
import { ReturnProjectionV2Schema } from '@wildshard/format/returnProjectionV2';
import { ScalarChannelSchema,ScalarLatticeSchema,ScalarTripletSchema } from '@wildshard/format/scalarChannel';
import { RuntimeBoundsSchema } from '@wildshard/format/clientPlan';
import { WorldUpdatesSchema } from '@wildshard/format/worldUpdates';
import { StreamedCoverSchema, CoverCompositionSchema } from '@wildshard/format/streamedCover';
import { MountedSpecimenSeatSchema } from '@wildshard/format/mountedSpecimenRows';
import { SpeciesActorsFileSchema, SpeciesLookBookSchema, CreatureGuestSchema } from '@wildshard/format/speciesBookRows';
import { PaintedLookSchema } from '@wildshard/format/paintedLook';
import { MaterialsSchema } from '@wildshard/format/materials';
import { ArenaScriptFightFileSchema,ArenaScriptGeometrySchema } from '@wildshard/format/arenaScriptRows';
import { TimedEncountersSchema, CloudSpecimenSchema, CloudBodySchema } from '@wildshard/format/encounterRows';
import { RoamingCombatSchema } from '@wildshard/format/roamingCombat';
import { PopulationProjectionSchema, EnemyPlacementsSchema } from '@wildshard/format/populationProjection';
import { CreatureInstallSchema, PackedCreatureLooksSchema } from '@wildshard/format/speciesLooks';
import { SceneScatterPageSchema, SceneDressingSchema, SceneBakedGeometrySchema, SceneFloorSchema, SceneDressingContactsSchema } from '@wildshard/format/sceneDressing';
import { CueDirectorWireSchema } from '@wildshard/format/cueDirector';
import { ExchangeSchema } from '@wildshard/format/exchange';
import { LootBagSchema } from '@wildshard/format/lootBag';
import { CatalogueEconomySchema } from '@wildshard/format/catalogueEconomy';
import { ClaimedPickupSchema } from '@wildshard/format/lootEconomy';
import { ContractCatalogueSchema, ContractBoardPageSchema } from '@wildshard/format/contracts';
import { AchievementCounterDataSchema } from '@wildshard/format/achievementCounters';
import { PopulationShelterSchema } from '@wildshard/format/herdShelter';
import { PanelDefinitionSchema,QuestPanelCatalogueSchema } from '@wildshard/format/panelTemplate';
import { HeldFinishesSchema } from '@wildshard/format/heldFinishes';
import { FigureCatalogueSchema, FigureGroupSchema } from '@wildshard/format/figures';
import { QuestStorySchema, ChapterStoryPresentationSchema, AdventureContentSchema } from '@wildshard/format/questStory';
import { WeatherProgramSchema, WeatherHitTagSchema } from '@wildshard/format/weatherProgram';
import { ForestWeatherSchema } from '@wildshard/format/forestWeather';
import { NativePopulationRowsSchema, TamingPoseFileSchema } from '@wildshard/format/populationRoster';
import { ChapterDirectorSchema, ChapterWakeSchema } from '@wildshard/format/chapterDirector';
import { EliteFeatureSchema } from '@wildshard/format/eliteFeature';
import { CoverAppearanceSchema } from '@wildshard/format/coverAppearance';
import { PageLifeSchema } from '@wildshard/format/pageLife';
import { InputActionSchema, InputKeysSchema } from '@wildshard/format/inputDeclarations';
import { BodySlotsSchema } from '@wildshard/format/bodySlots';
import { LimbRigSchema, LimbBlendSchema, BakedClipTable } from '@wildshard/format/limbRig';
import { LimbCollisionBake } from '@wildshard/format/limbCollision';
import { ToonArmsLookSchema, HeldArmsSchema, HeldGraphCardsSchema } from '@wildshard/format/heldArms';
import { GraphArmsSchema } from '@wildshard/format/graphArmsRows';
import { PracticeSceneSchema,RidingPracticeSchema,PracticeControllerSchema, FixedPracticeFileSchema } from '@wildshard/format/practiceCourseRows';
import { RoamingEncounterSchema, WakeEncounterSchema, BossEncounterPresentationSchema, NativeBossBindingSchema } from '@wildshard/format/bossEncounter';
import { BossProfileSchema, ArenaBossProfileSchema, RoamingBossProfileSchema, SpawnedBossProfileSchema, HeldBossProfileSchema, ScriptBossProfileSchema } from '@wildshard/format/bossProfiles';
import { NpcRowSchema, NpcMotionSchema, NpcDialogueRowSchema, QuestNpcBindingSchema, QuestNpcBindingsSchema, QuestPageTalksSchema } from '@wildshard/format/npcs';
import { WeaponProfileSchema, MeleeWeaponProfileSchema, BowWeaponProfileSchema, FirearmWeaponProfileSchema, ThrownWeaponProfileSchema, LashWeaponProfileSchema, ConeWeaponProfileSchema, HeldBowBaseSchema, HeldBowRowsSchema, HeldBowDefinitionSchema, HeldBowFileSchema, HeldFirearmPageSchema } from '@wildshard/format/weaponProfiles';
import { toJsonSchema, type JsonSchema } from '@valibot/to-json-schema';
import { finite, strictObject, object, looseObject, tuple, tupleWithRest, optional, array, literal as literalSchema, parse, safeParse as sourceSafeParse, pipe, check as sourceCheck, number, string, boolean, unknown, null as nullSchema, integer, minValue, maxValue, minLength, maxLength, startsWith, length, picklist, record, nullable, exactOptional, safeInteger, regex as sourceRegex, maxEntries, union, variant, assert, is as sourceIs, type VariantOptions, type SafeParseResult, type GenericSchema, type InferInput, type InferOutput } from 'valibot';
import { PopulationKeeperRowsSchema } from '@wildshard/format/populationKeeper';
import { EdgeProfileSchema, EdgeProfilesSchema } from '@wildshard/format/edgeProfiles';
import { PlumbingSchema } from '@wildshard/format/plumbing';
import { StateSchema } from '@wildshard/format/state';
import {QuestStepRowsSchema,QuestServiceActionsSchema,QuestKillRowsSchema,QuestHintRowsSchema,CarriedQuestSchema} from '@wildshard/format/questSteps';
import { SpeciesSchema } from '@wildshard/format/speciesPrograms';
import { BuildingLifeDocumentSchema, BakedBuildingLookSchema, BuildingLifeLookSchema, BuildingLifeRowsSchema, BuildingCloudPoseSchema } from '@wildshard/format/buildings';
import { WorldSceneWeldSchema, WorldSceneWeldNodeSchema } from '@wildshard/format/worldSceneWeld';
import { WorldSceneModelsSchema } from '@wildshard/format/worldSceneModels';
import { WorldScenePlacementSchema, WorldScenePlacementPageSchema } from '@wildshard/format/worldScenePlacement';
import { CommonsCostsSchema } from '@wildshard/format/commonsCosts';
import { SHARDFILE_ADMISSION_LIMITS } from '@wildshard/format/admissionLimits';
import { registeredJsonContract,type RegisteredSchemaJsonName } from '@wildshard/format/registeredJson';

import { StalkerSchema, GuardianPatternsSchema, SkirmisherSchema, ScriptBrainSchema, GuardianSchema, PerchHunterSchema } from '@wildshard/format/brains';
import { DiverSchema, OrbitDiverSchema, PatrolDiverSchema, BurstFlyerSchema } from '@wildshard/format/flyers';
import { RamGrazerSchema, ChallengeGrazerSchema, GrazerSchema } from '@wildshard/format/grazers';
import { GroupBrainSchema } from '@wildshard/format/groupBrains';
import { CreaturesSchema, CreatureHomeSchema, CreatureStrikeSchema } from '@wildshard/format/creatures';
import { FlockSchema } from '@wildshard/format/crowds';
import { EncountersSchema } from '@wildshard/format/encounters';
import { AudioMusicSchema, AudioSamplesSchema, AudioZonesSchema } from '@wildshard/format/audioProfiles';
import { AudioRoutingSchema } from '@wildshard/format/audioRouting';
import { AudioDataSchema } from '@wildshard/format/audio';
import { LedgerFactSchema, LedgerRulesSchema } from '@wildshard/format/ledger';
import { DirectorSchema } from '@wildshard/format/director';
import { DirectorDocumentSchema } from '@wildshard/format/directorDocument';
import { DirectorStagesSchema } from '@wildshard/format/directorStages';
import { LogicalStateSchema, MigrationsSchema } from '@wildshard/format/migrations';
import { TraversalSchema } from '@wildshard/format/traversal';
import { RuntimeBindsSchema } from '@wildshard/format/runtimeBinds';
import { RuntimeSpawnsSchema } from '@wildshard/format/runtimeSpawns';
import { SkinPoseLayerSchema } from '@wildshard/format/skinLayers';
import { PresentationSchema } from '@wildshard/format/presentation';
import { MeshCollisionSchema } from '@wildshard/format/meshCollision';
import { ScriptBindingsSchema } from '@wildshard/format/scripts';
import { ActorMovesSchema } from '@wildshard/format/actorMoves';
import { DecisionScriptsSchema } from '@wildshard/format/decisionScripts';
import { HooksSchema } from '@wildshard/format/hooks';
import { TerrainSchema,ForestRowsSchema,GroundRowsSchema } from '@wildshard/format/terrain';
import { WaterSchema } from '@wildshard/format/water';
import { AccentSchema, ACCENT_IDS } from '@wildshard/format/accent';
import { ItemsSchema, ItemFamilyNameSchema } from '@wildshard/format/items';
import { TargetsSchema } from '@wildshard/format/targets';
import { QuestDataSchema } from '@wildshard/format/quests';
import { QuestGraphSchema } from '@wildshard/format/questGraph';
import { InteractionRowsSchema, QuestPageInteractionsSchema } from '@wildshard/format/questInteractions';
import { QuestPageSchema, QuestPageCompositionSchema, ChapterViewSchema } from '@wildshard/format/questPageComposition';
import { QuestContinuationSchema } from '@wildshard/format/questContinuation';
import { QuestWorldSchema } from '@wildshard/format/questWorld';
import { QuestFiguresSchema, KitFigureCardsSchema } from '@wildshard/format/questFigures';
import { QuestHostSchema } from '@wildshard/format/questHost';

import { RowsSchema } from '@wildshard/format/rows';
import { MoversSchema } from '@wildshard/format/movers';
import { ModesSchema, ZiplineModeSchema, UpdraftModeSchema, RideGaitsSchema, RideModeSchema, GrappleModeSchema, TraverseModeSchema } from '@wildshard/format/modes';
import { MoverMotionSchema, MoverTrackSchema, MoverTriggerSchema, MoverDriverSchema } from '@wildshard/format/moverMotion';
import { SocketLiftSchema } from '@wildshard/format/socketLift';
import { PortalLinkSchema } from '@wildshard/format/portalLink';
import { EntrywaysSchema } from '@wildshard/format/entryways';
import { NavigationSchema } from '@wildshard/format/navigation';
import { NativeGroundSchema } from '@wildshard/format/nativeGround';
import { UiSchema } from '@wildshard/format/ui';
import { ClientScriptsSchema } from '@wildshard/format/clientScripts';
import { HeldMeleeActionSchema, ClientChannelsSchema, ClientChannelProgramSchema, PrivateSceneSchema, WorldSceneSchema, NumericPoseSchema } from '@wildshard/format/clientChannels';

import { ForestLifeSchema, AmbientFlockSchema, AmbientPerchesSchema, ForagerContinuation } from '@wildshard/format/ambientLife';

import { MemoryMeasurementSchema, RuntimeCostSchema, RegionalSimCostSchema } from '@wildshard/format/runtimeCost';
import { RuntimeSchema, ClientPlanRuntimeSchema } from '@wildshard/format/runtime';
import { ClientCheckpointSchema, ItemCheckpointStatesSchema, LogicalClientCheckpointSchema } from '@wildshard/format/clientState';
import { LiftRiderSchema } from '@wildshard/format/liftRider';
import { ScriptSpeciesSchema } from '@wildshard/format/speciesScripts';
import { EliteScriptSchema } from '@wildshard/format/eliteScripts';
import { SkinLookParametersSchema, SkinClipParametersSchema, ShardSkinFileSchema } from '@wildshard/format/skins';
import { SkinClipNameSchema, SkinRowSchema, SkinBindingSchema } from '@wildshard/format/skinData';

import { ShardNaturalSchema, ShardFiniteSchema, ShardHashSchema, ShardReferenceSchema, ShardReferencesSchema, ShardNamesSchema, CellBoundsSchema, IdentitySchema, RequiresSchema, BudgetsSchema, SimSchema, AuthorCapsSchema, ServerBudgetSchema, FilesSchema, TilesSchema, LibrarySchema, CriticalSchema, FarSchema, SpawnSchema } from '@wildshard/format/shardSections';

/** JSON Schema plus explicit admission checks that JSON Schema cannot express. */
export interface FormatJsonSchema extends JsonSchema {
  'x-wildshard-checks'?: string[];
  'x-wildshard-string-length'?: 'utf16-code-units';
}

const plumbing = PlumbingSchema.pipe[2];
const input = plumbing.entries.input.pipe[0].item;
const debug = plumbing.entries.debug.pipe[0].item;
// These identities are the defining schemas, not message-based permissions for arbitrary author code.
const customSchemas = new Map<object, FormatJsonSchema>([
  [WeatherHitTagSchema, { type: 'string', pattern: '^[a-z][a-zA-Z0-9.-]*\\.[a-zA-Z0-9.*-]+$' }],
  [InputActionSchema.options[1], { type: 'string', maxLength: 128, pattern: '^[a-z][a-zA-Z0-9-]*(?:\\.[a-zA-Z0-9-]+)+$' }],
  [input.entries.id, { type: 'string', maxLength: 128, pattern: '^[a-z][a-z0-9-]*(?:\\.[a-z][a-zA-Z0-9-]*)+$' }],
  [debug.entries.ask, { type: 'string', pattern: '^E[1-9][0-9]*$' }],
]);
// Faithful projection of the native four-field header predicate. Registered
// post documents additionally run complete scaled-post and graph admission.
customSchemas.set(ScaledPostInputSchema, { type: 'object', required: ['programs', 'draws', 'targets', 'outputs'],
  'x-wildshard-checks': ['@wildshard/format/scaledPostContract#parseScaledPostRow'] } satisfies FormatJsonSchema);
customSchemas.set(HeldCueSchema, { type: 'string', pattern: '^cue\\.[a-z][a-zA-Z0-9.-]*$' });
customSchemas.set(ArcWeaponItemSchema, { type: 'string', pattern: '^weapon\\.[a-z][a-zA-Z0-9.-]*$' });
const postIdentityTransforms = new Set([...postGraphIdentityTransforms, ...uniformIdentityTransforms]);
customSchemas.set(HeldMeleeActionSchema, { type: 'string', pattern: '^[a-z][a-zA-Z0-9-]*\\.[a-zA-Z0-9.-]+$' });
const bowVariant = BowVariantSchema.pipe[2].entries;
customSchemas.set(bowVariant.id, { type: 'string', pattern: '^weapon\\.[a-z0-9.-]+$' });
customSchemas.set(bowVariant.sourceTag, { type: 'string', pattern: '^[^.]+\\..+$' });
customSchemas.set(CreatureStrikeSchema.entries.tags.pipe[0].item, { type: 'string', maxLength: 128, pattern: '^[a-z][a-zA-Z0-9.-]*\\.[a-zA-Z0-9.*-]+$' });
// Exact fixed-palette validator; a caller's new custom schema receives no bridge.
customSchemas.set(AccentSchema.pipe[2], { type: 'string', enum: [...ACCENT_IDS] });
// Template-literal item identities keep their exact native predicates; only these defining schema objects bridge.
const itemRows = ItemsSchema.pipe[2].entries.rows.pipe[0].item;
const weaponRow = itemRows.options[0], toolRow = itemRows.options[1];
customSchemas.set(weaponRow.entries.id, { type: 'string', maxLength: 128, pattern: '^weapon\\.[a-z][a-zA-Z0-9.-]*$' });
customSchemas.set(toolRow.entries.id, { type: 'string', maxLength: 128, pattern: '^tool\\.[a-z][a-zA-Z0-9.-]*$' });
customSchemas.set(weaponRow.entries.slot, { type: 'string', maxLength: 128, pattern: '^declared\\.weapon\\.[a-z][a-zA-Z0-9.-]*$' });
customSchemas.set(weaponRow.entries.light.entries.tags.pipe[0].item, { type: 'string', maxLength: 128, pattern: '^[a-z][a-zA-Z0-9.-]*\\.[a-zA-Z0-9.-]+$' });
customSchemas.set(ConeWeaponProfileSchema.entries.gust.entries.tags.pipe[0].item, { type: 'string', maxLength: 128, pattern: '^[a-z][a-zA-Z0-9.-]*\\.[a-zA-Z0-9.-]+$' });
customSchemas.set(weaponRow.entries.light.entries.effect.wrapped, { type: 'string', pattern: '^effect\\.[a-z][a-zA-Z0-9.-]*$' });
customSchemas.set(toolRow.entries.action.wrapped, { type: 'string', pattern: '^[a-z][a-zA-Z0-9.-]*\\.[a-zA-Z0-9.-]+$' });
// The namespaced combat tag validator is the exact defining row object.
customSchemas.set(RowsSchema.pipe[2].entries.strikes.pipe[0].item.entries.tags.pipe[0].item, { type: 'string', maxLength: 128, pattern: '^[a-z][a-zA-Z0-9.-]*\\.[a-zA-Z0-9.-]+$' });
const unicodeRegexes = new Set<object>([
  plumbing.entries.namespace.pipe[1],
  InputKeysSchema.pipe[0].item.pipe[1],
  debug.entries.reviewBy.pipe[1],
]);
const stateField = StateSchema.pipe[0].entries.shared.pipe[0].item;
unicodeRegexes.add(stateField.entries.name.pipe[1]);
unicodeRegexes.add(CommonsCostsSchema.pipe[0].key.pipe[1]);
const edge = EdgeProfileSchema.pipe[0];
const finiteNumbers = new Set<object>([
  edge.entries.heights.item.pipe[1],
  stateField.entries.default.options[1].pipe[1],
  ...edge.entries.colours.item.items.map(channel => channel.pipe[1]),
]);

// Only the exact retained defining roots grant action bridges. A caller's new check or transform never joins.
const wireRoots: Readonly<Record<string, GenericSchema>> = {
  'audioScene.AudioScene': AudioSceneSchema,
  'forestPage.LivingPageSites': LivingPageSitesSchema,
  'fixedDraws.FixedDrawRows': FixedDrawRowsSchema,
  'forestPage.ForestPage': ForestPageSchema,
  'forestPage.ForestGroundLayout': ForestGroundLayoutSchema,
  'caveInterior.CaveFile': CaveFileSchema,
  'caveInterior.CaveInterior': CaveInteriorSchema,
  'streamedCover.CoverComposition': CoverCompositionSchema,
  'speciesLooks.CreatureInstall': CreatureInstallSchema,
  'speciesLooks.PackedCreatureLooks': PackedCreatureLooksSchema,
  'questPageComposition.QuestPageComposition': QuestPageCompositionSchema,
  'chapterDirector.ChapterWake': ChapterWakeSchema,
  'bowVariantRows.BowVariant': BowVariantSchema,
  'scalarChannel.ScalarChannel': ScalarChannelSchema,
  'terrain.ForestRows': ForestRowsSchema,
  'clientPlan.RuntimeBounds': RuntimeBoundsSchema,
  'worldUpdates.WorldUpdates': WorldUpdatesSchema,
  'streamedCover.StreamedCover': StreamedCoverSchema,
  'practiceCourseRows.PracticeScene':PracticeSceneSchema,
  'graphArmsRows.GraphArms': GraphArmsSchema,
  'practiceCourseRows.RidingPractice':RidingPracticeSchema,
  'mountedSpecimenRows.MountedSpecimenSeat': MountedSpecimenSeatSchema,
  'speciesBookRows.SpeciesActorsFile': SpeciesActorsFileSchema,
  'arenaScriptRows.ArenaScriptFightFile': ArenaScriptFightFileSchema,
  'arenaScriptRows.ArenaScriptGeometry': ArenaScriptGeometrySchema,
  'encounterRows.TimedEncounters': TimedEncountersSchema,
  'encounterRows.CloudSpecimen': CloudSpecimenSchema,
  'roamingCombat.RoamingCombat': RoamingCombatSchema,
  'populationProjection.PopulationProjection': PopulationProjectionSchema,
  'populationProjection.EnemyPlacements': EnemyPlacementsSchema,
  'sceneDressing.SceneDressing': SceneDressingSchema,
  'clientChannels.NumericPose': NumericPoseSchema,
  'populationKeeper.PopulationKeeperRows': PopulationKeeperRowsSchema,
  'questInteractions.QuestPageInteractions': QuestPageInteractionsSchema,
  'questPageComposition.QuestPage': QuestPageSchema,
  'questContinuation.QuestContinuation': QuestContinuationSchema,
  'questWorld.QuestWorld': QuestWorldSchema,
  'questFigures.QuestFigures': QuestFiguresSchema,
  'questFigures.KitFigureCards': KitFigureCardsSchema,
  'cueDirector.CueDirectorWire': CueDirectorWireSchema,
  'questSteps.QuestHintRows': QuestHintRowsSchema,
  'questSteps.QuestKillRows': QuestKillRowsSchema,
  'questSteps.QuestServiceActions': QuestServiceActionsSchema,
  'exchange.Exchange': ExchangeSchema,
  'catalogueEconomy.CatalogueEconomy': CatalogueEconomySchema,
  'lootBag.LootBag': LootBagSchema,
  'contracts.ContractCatalogue': ContractCatalogueSchema,
  'achievementCounters.AchievementCounterData': AchievementCounterDataSchema,
  'herdShelter.PopulationShelter': PopulationShelterSchema,
  'panelTemplate.PanelDefinition': PanelDefinitionSchema,
  'heldFinishes.HeldFinishes': HeldFinishesSchema,
  'figures.FigureCatalogue': FigureCatalogueSchema,
  'figures.FigureGroup': FigureGroupSchema,
  'questStory.QuestStory': QuestStorySchema,
  'weatherProgram.WeatherProgram': WeatherProgramSchema,
  'forestWeather.ForestWeather': ForestWeatherSchema,
  'populationRoster.NativePopulationRows': NativePopulationRowsSchema,
  'chapterDirector.ChapterDirector': ChapterDirectorSchema,
  'eliteFeature.EliteFeature': EliteFeatureSchema,
  'coverAppearance.CoverAppearance': CoverAppearanceSchema,
  'pageLife.PageLife': PageLifeSchema,
  'worldSceneWeld.WorldSceneWeld': WorldSceneWeldSchema,
  'worldSceneModels.WorldSceneModels': WorldSceneModelsSchema,
  'sceneBuffers.SceneBuffers': SceneBuffersSchema,
  'worldScenePlacement.WorldScenePlacement': WorldScenePlacementSchema,
  'clientChannels.WorldScene': WorldSceneSchema,
  'buildings.BuildingLifeRows': BuildingLifeRowsSchema,
  'buildings.BuildingCloudPose': BuildingCloudPoseSchema,
  'bodySlots.BodySlots': BodySlotsSchema,
  'limbRig.LimbRig': LimbRigSchema,
  'limbRig.LimbBlend': LimbBlendSchema,
  'limbRig.BakedClipTable': BakedClipTable,
  'limbCollision.LimbCollisionBake': LimbCollisionBake,
  'plumbing.Plumbing': PlumbingSchema,
  'heldArms.ToonArmsLook': ToonArmsLookSchema,
  'npcs.QuestNpcBinding': QuestNpcBindingSchema,
  'questHost.QuestHost': QuestHostSchema,
  'npcs.QuestNpcBindings': QuestNpcBindingsSchema,
  'npcs.NpcRow': NpcRowSchema,
  'npcs.NpcMotion': NpcMotionSchema,
  'npcs.NpcDialogueRow': NpcDialogueRowSchema,
  'bossProfiles.BossProfile': BossProfileSchema,
  'bossProfiles.ArenaBossProfile': ArenaBossProfileSchema,
  'bossProfiles.RoamingBossProfile': RoamingBossProfileSchema,
  'bossProfiles.SpawnedBossProfile': SpawnedBossProfileSchema,
  'bossProfiles.HeldBossProfile': HeldBossProfileSchema,
  'bossProfiles.ScriptBossProfile': ScriptBossProfileSchema,
  'bossEncounter.RoamingEncounter': RoamingEncounterSchema,
  'bossEncounter.WakeEncounter': WakeEncounterSchema,
  'bossEncounter.BossEncounterPresentation': BossEncounterPresentationSchema,
  'bossEncounter.NativeBossBinding': NativeBossBindingSchema,
  'weaponProfiles.WeaponProfile': WeaponProfileSchema,
  'weaponProfiles.MeleeWeaponProfile': MeleeWeaponProfileSchema,
  'weaponProfiles.BowWeaponProfile': BowWeaponProfileSchema,
  'weaponProfiles.FirearmWeaponProfile': FirearmWeaponProfileSchema,
  'weaponProfiles.ThrownWeaponProfile': ThrownWeaponProfileSchema,
  'weaponProfiles.LashWeaponProfile': LashWeaponProfileSchema,
  'weaponProfiles.ConeWeaponProfile': ConeWeaponProfileSchema,
  'weaponProfiles.HeldBowBase': HeldBowBaseSchema,
  'weaponProfiles.HeldBowRows': HeldBowRowsSchema,
  'weaponProfiles.HeldBowDefinition': HeldBowDefinitionSchema,
  'brains.Skirmisher': SkirmisherSchema,
  'brains.Stalker': StalkerSchema,
  'brains.ScriptBrain': ScriptBrainSchema,
  'brains.Guardian': GuardianSchema,
  'brains.GuardianPatterns': GuardianPatternsSchema,
  'brains.PerchHunter': PerchHunterSchema,
  'flyers.Diver': DiverSchema,
  'flyers.OrbitDiver': OrbitDiverSchema,
  'flyers.PatrolDiver': PatrolDiverSchema,
  'flyers.BurstFlyer': BurstFlyerSchema,
  'grazers.Grazer': GrazerSchema,
  'grazers.RamGrazer': RamGrazerSchema,
  'grazers.ChallengeGrazer': ChallengeGrazerSchema,
  'groupBrains.GroupBrain': GroupBrainSchema,
  'creatures.Creatures': CreaturesSchema,
  'creatures.CreatureHome': CreatureHomeSchema,
  'crowds.Flock': FlockSchema,
  'encounters.Encounters': EncountersSchema,
  'audioProfiles.AudioMusic': AudioMusicSchema,
  'audioProfiles.AudioSamples': AudioSamplesSchema,
  'audioProfiles.AudioZones': AudioZonesSchema,
  'audioRouting.AudioRouting': AudioRoutingSchema,
  'audio.AudioData': AudioDataSchema,
  'ledger.LedgerFact': LedgerFactSchema,
  'ledger.LedgerRules': LedgerRulesSchema,
  'director.Director': DirectorSchema,
  'directorDocument.DirectorDocument': DirectorDocumentSchema,
  'directorStages.DirectorStages': DirectorStagesSchema,
  'migrations.LogicalState': LogicalStateSchema,
  'migrations.Migrations': MigrationsSchema,
  'traversal.Traversal': TraversalSchema,
  'runtimeBinds.RuntimeBinds': RuntimeBindsSchema,
  'runtimeSpawns.RuntimeSpawns': RuntimeSpawnsSchema,
  'skinLayers.SkinPoseLayer': SkinPoseLayerSchema,
  'presentation.Presentation': PresentationSchema,
  'meshCollision.MeshCollision': MeshCollisionSchema,
  'scripts.ScriptBindings': ScriptBindingsSchema,
  'actorMoves.ActorMoves': ActorMovesSchema,
  'decisionScripts.DecisionScripts': DecisionScriptsSchema,
  'hooks.Hooks': HooksSchema,
  'terrain.Terrain': TerrainSchema,
  'water.Water': WaterSchema,
  'accent.Accent': AccentSchema,
  'items.ItemFamilyName': ItemFamilyNameSchema,
  'items.Items': ItemsSchema,
  'targets.Targets': TargetsSchema,
  'quests.QuestData': QuestDataSchema,
  'questGraph.QuestGraph': QuestGraphSchema,
  'questSteps.QuestStepRows': QuestStepRowsSchema,
  'speciesPrograms.Species': SpeciesSchema,
  'buildings.BakedBuildingLook': BakedBuildingLookSchema,
  'buildings.BuildingLifeLook': BuildingLifeLookSchema,
  'questInteractions.InteractionRows': InteractionRowsSchema,
  'rows.Rows': RowsSchema,
  'movers.Movers': MoversSchema,
  'modes.Modes': ModesSchema,
  'modes.ZiplineMode': ZiplineModeSchema,
  'modes.UpdraftMode': UpdraftModeSchema,
  'modes.RideGaits': RideGaitsSchema,
  'modes.RideMode': RideModeSchema,
  'modes.GrappleMode': GrappleModeSchema,
  'modes.TraverseMode': TraverseModeSchema,
  'moverMotion.MoverMotion': MoverMotionSchema,
  'moverMotion.MoverTrack': MoverTrackSchema,
  'moverMotion.MoverTrigger': MoverTriggerSchema,
  'moverMotion.MoverDriver': MoverDriverSchema,
  'socketLift.SocketLift': SocketLiftSchema,
  'portalLink.PortalLink': PortalLinkSchema,
  'entryways.Entryways': EntrywaysSchema,
  'navigation.Navigation': NavigationSchema,
  'nativeGround.NativeGround': NativeGroundSchema,
  'ui.Ui': UiSchema,
  'clientScripts.ClientScripts': ClientScriptsSchema,
  'clientChannels.ClientChannels': ClientChannelsSchema,
  'clientChannels.ClientChannelProgram': ClientChannelProgramSchema,
  'clientChannels.PrivateScene': PrivateSceneSchema,
  'ambientLife.ForestLife': ForestLifeSchema,
  'runtimeCost.MemoryMeasurement': MemoryMeasurementSchema,
  'runtimeCost.RuntimeCost': RuntimeCostSchema,
  'runtimeCost.RegionalSimCost': RegionalSimCostSchema,
  'runtime.Runtime': RuntimeSchema,
  'runtime.ClientPlan': ClientPlanRuntimeSchema,
  'clientState.ClientCheckpoint': ClientCheckpointSchema,
  'clientState.ItemCheckpointStates': ItemCheckpointStatesSchema,
  'clientState.LogicalClientCheckpoint': LogicalClientCheckpointSchema,
  'liftRider.LiftRider': LiftRiderSchema,
  'speciesScripts.ScriptSpecies': ScriptSpeciesSchema,
  'eliteScripts.EliteScript': EliteScriptSchema,
  'skins.SkinLookParameters': SkinLookParametersSchema,
  'skins.SkinClipParameters': SkinClipParametersSchema,
  'skins.ShardSkinFile': ShardSkinFileSchema,
  'skinData.SkinClipName': SkinClipNameSchema,
  'skinData.SkinRow': SkinRowSchema,
  'skinData.SkinBinding': SkinBindingSchema,
  'shardSections.ShardNatural': ShardNaturalSchema,
  'shardSections.ShardFinite': ShardFiniteSchema,
  'shardSections.ShardHash': ShardHashSchema,
  'shardSections.ShardReference': ShardReferenceSchema,
  'shardSections.ShardReferences': ShardReferencesSchema,
  'shardSections.ShardNames': ShardNamesSchema,
  'shardSections.CellBounds': CellBoundsSchema,
  'shardSections.Identity': IdentitySchema,
  'shardSections.Requires': RequiresSchema,
  'shardSections.Budgets': BudgetsSchema,
  'shardSections.Sim': SimSchema,
  'shardSections.AuthorCaps': AuthorCapsSchema,
  'shardSections.ServerBudget': ServerBudgetSchema,
  'shardSections.Files': FilesSchema,
  'shardSections.Tiles': TilesSchema,
  'shardSections.Library': LibrarySchema,
  'shardSections.Critical': CriticalSchema,
  'shardSections.Far': FarSchema,
  'shardSections.Spawn': SpawnSchema,
  'terrain.GroundRows': GroundRowsSchema,
  'scalarChannel.ScalarLattice': ScalarLatticeSchema,
  'practiceCourseRows.Controller': PracticeControllerSchema,
  'scalarChannel.ScalarTriplet': ScalarTripletSchema,
  'returnProjectionV2.ReturnProjectionV2': ReturnProjectionV2Schema,
  'scriptContract.ReturnModules': ReturnModulesSchema,
  'nativePhysics.NativeGroundFile': NativeGroundFileSchema,
  'worldAssembly.WorldAssembly': WorldAssemblySchema,
  'binarySource.BinarySource': BinarySourceSchema,
  'namedJsonContracts.QuestTrader': QuestTraderSchema,
  'namedJsonContracts.AdventurePersistence': AdventurePersistenceSchema,
  'namedJsonContracts.PosedLibrary': PosedLibrarySchema,
  'populationEnvironment.PopulationField': PopulationFieldSchema,
  'namedJsonContracts.PageReturnRows': PageReturnRowsSchema,
  'worldScenePlacement.WorldScenePlacementPage': WorldScenePlacementPageSchema,
  'questSteps.CarriedQuest': CarriedQuestSchema,
  'nativeQuestComposition.NativeQuestComposition': NativeQuestCompositionSchema,
  'nativeQuestComposition.NativeQuestServiceSpots': NativeQuestServiceSpotsSchema,
  'panelTemplate.QuestPanelCatalogue': QuestPanelCatalogueSchema,
  'sceneDressing.SceneScatterPage': SceneScatterPageSchema,
  'buildings.BuildingLifeDocument': BuildingLifeDocumentSchema,
  'bakedTiles.BakedPlacementPlan': BakedPlacementPlanSchema,
  'sceneSources.SceneModelSource': SceneModelSourceSchema,
  'sceneSources.SceneBakeSource': SceneBakeSourceSchema,
  'worldScenePages.WorldScenePage': WorldScenePageSchema,
  'weatherBundle.WeatherBundle': WeatherBundleSchema,
  'weatherBundle.WeatherDocument': WeatherDocumentSchema,
  'weatherEffects.WeatherEffects': WeatherEffectsSchema,
  'rainPresentation.RainPresentation': RainPresentationSchema,
  'rangedPage.ForestWeatherObservation': ForestWeatherObservationSchema,
  'paintedResources.PaintedAir': PaintedAirSchema,
  'paintedResources.PaintedGround': PaintedGroundSchema,
  'paintedResources.PaintedPanorama': PaintedPanoramaSchema,
  'paintedResources.PainterKeyLight': PainterKeyLightSchema,
  'paintedResources.PainterlyWorld': PainterlyWorldSchema,
  'postGraphLook.PostGraphLook': PostGraphLookSchema,
  'questStory.ChapterStoryPresentation': ChapterStoryPresentationSchema,

  'mixedPopulation.PerchBodyFile': PerchBodyFileSchema,
  'returnProgramDocument.ReturnProgramDocument': ReturnProgramDocumentSchema,
  'returnProgramDocument.ReturnProgramWireDocument': ReturnProgramWireDocumentSchema,
  'populationEnvironment.PopulationHabitat': PopulationHabitatSchema,
  'populationRoster.TamingPoseFile': TamingPoseFileSchema,
  'questStory.AdventureContent': AdventureContentSchema,
  'findsCatalogue.FindsCatalogue': FindsCatalogueSchema,
  'wildlifePopulation.WildlifePopulation': WildlifePopulationSchema,
  'practiceCourseRows.FixedPracticeFile': FixedPracticeFileSchema,
  'islandLibrary.FixedGeometryGroups': FixedGeometryGroupsSchema,
  'specimenCatalogue.SpecimenBook': SpecimenBookSchema,
  'heldArms.HeldGraphCards': HeldGraphCardsSchema,
  'arenaRoomDocument.ArenaRoomDocument': ArenaRoomDocumentSchema,
  'riding.ClientRidingSession': ClientRidingSessionSchema,
  'rangedPage.RangedPage': RangedPageSchema,
  'speciesActorsFile.SpeciesActorsFile': SpeciesActorsDocumentSchema,

  'forestNativeInputs.ForestNativeInputs': ForestNativeInputsSchema,
  'waterWorld.WaterWorld': WaterWorldSchema,
  'weaponProfiles.HeldBowFile': HeldBowFileSchema,
  'weaponProfiles.HeldFirearmPage': HeldFirearmPageSchema,
  'heldWeaponDocuments.BladeDocument': BladeDocumentSchema,
  'heldWeaponDocuments.PolearmDocument': PolearmDocumentSchema,
  'heldWeaponDocuments.HeldSlotsDocument': HeldSlotsDocumentSchema,
  'heldJianDocument.HeldJianDocument': HeldJianDocumentSchema,
  'questInteractionSource.QuestInteractionSource': QuestInteractionSourceSchema,
  'questRuntime.QuestRuntimeDocument': QuestRuntimeDocumentSchema,
  'questStoryBindings.QuestStoryBindings': QuestStoryBindingsSchema,
  'questPageComposition.ChapterView': ChapterViewSchema,
};
const wireChecks = new Map<object, string>();
const wireFinite = new Set<object>();
const wireRegexes = new Set<object>();
function rememberActions(value: unknown, path: string, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  const kind: unknown = Reflect.get(value, 'kind'), type: unknown = Reflect.get(value, 'type');
  if (kind === 'schema' && type === 'lazy') {
    const getter: unknown = Reflect.get(value, 'getter');
    if (typeof getter === 'function') {
      const nested: unknown = Reflect.apply(getter, undefined, [undefined]);
      rememberActions(nested, `${path}.wrapped`, seen);
    }
  }
  if (kind === 'validation') {
    if (type === 'check' && !wireChecks.has(value)) wireChecks.set(value, path);
    else if (type === 'finite') wireFinite.add(value);
    else if (type === 'regex') {
      const regex: unknown = Reflect.get(value, 'requirement');
      if (regex instanceof RegExp && regex.flags === 'u') wireRegexes.add(value);
    }
  }
  for (const [key, child] of Object.entries(value)) rememberActions(child, `${path}.${key}`, seen);
}
for (const [key, schema] of Object.entries(wireRoots)) {
  const module = key.slice(0, key.indexOf('.')), binding = key.slice(key.indexOf('.') + 1);
  rememberActions(schema, `@wildshard/format/${module}#${binding}Schema`, new WeakSet());
}
// A composed quest host shares this exact check object; its nested path must not rename the defining public check.
wireChecks.set(DirectorStagesSchema.pipe[1], '@wildshard/format/directorStages#DirectorStagesSchema.pipe.1');
// ChapterWake borrows this check; composition cannot rename its defining public identity.
const wakePipe: unknown = Reflect.get(WakeEncounterSchema, 'pipe');
const wakeCheck: unknown = Array.isArray(wakePipe) ? wakePipe[1] : undefined;
if (typeof wakeCheck !== 'object' || wakeCheck === null
  || Reflect.get(wakeCheck, 'kind') !== 'validation' || Reflect.get(wakeCheck, 'type') !== 'check') {
  throw new Error('Missing defining wake encounter validation');
}
wireChecks.set(wakeCheck, '@wildshard/format/bossEncounter#WakeEncounterSchema.pipe.1');

/** Share only complete native grammars within these exact documents. The
 * defining format parsers still own every semantic and resource admission. */
function encounterDefinitions(schema: GenericSchema): Record<string, GenericSchema> | undefined {
  if (schema === ArenaScriptFightFileSchema) return {
    room: ArenaRoomDocumentRowsSchema, king: ArenaKingRowsSchema, privateScene: PrivateSceneSchema,
    bossProfile: BossProfileSchema, legacyReturn: ReturnProgramSchema, completeReturn: ReturnProgramDocumentSchema,
    projection: ReturnProjectionV2Schema,
  };
  if (schema === ArenaRoomDocumentSchema) return {
    room: ArenaRoomDocumentRowsSchema, privateScene: PrivateSceneSchema, bossProfile: BossProfileSchema,
    legacyReturn: ReturnProgramSchema, completeReturn: ReturnProgramDocumentSchema, projection: ReturnProjectionV2Schema,
  };
  if (schema === ArenaScriptGeometrySchema) return {
    privateScene: PrivateSceneSchema, nativeGeometry: WeatherGeometrySchema, channelPrograms: ClientChannelsSchema,
  };
  if (schema === CloudSpecimenSchema) return {
    cloudBody: CloudBodySchema, privateScene: PrivateSceneSchema,
    nativeGeometry: WeatherGeometrySchema, channelPrograms: ClientChannelsSchema,
  };
  if (schema === ClientRidingSessionSchema) return {
    legacyReturn: ReturnProgramSchema, completeReturn: ReturnProgramDocumentSchema, projection: ReturnProjectionV2Schema,
  };
  if (schema === TimedEncountersSchema) return {
    nativeGeometryData: WeatherGeometryDataSchema, projection: ReturnProjectionV2Schema,
  };
  if (schema === MountedSpecimenSeatSchema) return { bakedGeometry: SceneBakedGeometrySchema };
  return undefined;
}

/** Complete repeated grammars factored only within the approved native documents. */
function heldDocumentDefinitions(schema: GenericSchema): Record<string, GenericSchema> | undefined {
  if (schema === HeldJianDocumentSchema) return {
    graphArms: GraphArmsSchema, postGraph: PostGraphLookSchema, channels: ClientChannelsSchema,
  };
  if (schema === BladeDocumentSchema || schema === PolearmDocumentSchema || schema === HeldSlotsDocumentSchema) return {
    completeReturn: ReturnProgramDocumentSchema, projection: ReturnProjectionV2Schema,
  };
  if (schema === WaterWorldSchema) return {
    sceneNode: WorldSceneWeldNodeSchema, completeReturn: ReturnProgramDocumentSchema, projection: ReturnProjectionV2Schema,
  };
  if (schema === HeldFirearmPageSchema) return { channels: ClientChannelsSchema };
  return undefined;
}

/**
 * Convert an author schema with the official converter, refusing every unrecognised custom check or transform.
 * The extracted format checks have explicit bridges. Plumbing's cross-field checks remain named mandatory
 * admission checks; Valibot string bounds use UTF-16 code units, unlike JSON Schema's Unicode code points.
 * The custom-section bridge uses draft-07; existing wire documents keep draft-2020-12.
 * This structural document never replaces the defining format parser's admission verdict.
 */
export function formatJsonSchema(schema: GenericSchema, target: 'draft-07' | 'draft-2020-12' = 'draft-2020-12'): FormatJsonSchema {
  const heldDefinitions = heldDocumentDefinitions(schema);
  const definitions = encounterDefinitions(schema);
  return toJsonSchema(schema, {
    target, errorMode: 'throw', typeMode: 'output',
    // Both page kinds share the complete node grammar. A local definition
    // retains every constraint without repeating that grammar per branch.
    ...(schema === WorldScenePageSchema ? { definitions: { sceneNode: WorldSceneWeldNodeSchema } } : {}),
    // Both existing weather wires contain the same complete phase program.
    ...(schema === WeatherDocumentSchema ? { definitions: { weatherProgram: WeatherProgramSchema } } : {}),
    ...(heldDefinitions === undefined ? {} : { definitions: heldDefinitions }),
    // The complete sheep document keeps both original return envelopes and
    // exact-input script/projection constraints, shared without repetition.
    ...(schema === SpeciesActorsDocumentSchema ? { definitions: { legacyReturn: ReturnProgramSchema, wireReturn: ReturnProgramWireDocumentSchema, projection: ReturnProjectionV2Schema } } : {}),
    ...(definitions === undefined ? {} : { definitions }),
    // The population's six identical return descriptors share their complete
    // native grammars; the defining parser and every wire constraint remain.
    ...(schema === WildlifePopulationSchema ? { definitions: { legacyReturn: ReturnProgramSchema, projection: ReturnProjectionV2Schema } } : {}),
    ...(schema === PopulationProjectionSchema || schema === PerchBodyFileSchema ? { definitions: { legacyReturn: ReturnProgramSchema, wireReturn: ReturnProgramWireDocumentSchema, projection: ReturnProjectionV2Schema } } : {}),
    overrideSchema: ({ valibotSchema }) => customSchemas.get(valibotSchema),
    overrideAction: ({ valibotAction, jsonSchema, errors }) => {
      if (postIdentityTransforms.has(valibotAction)) return jsonSchema;
      // Exact one-pass sample transforms retain the original wire grammar; JSON numbers are finite.
      if (valibotAction === SkinPoseLayerSchema.entries.times.pipe[1]) return { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 4097 };
      if (valibotAction === SkinPoseLayerSchema.entries.tracks.pipe[0].item.entries.values.pipe[1]) return { type: 'array', items: { type: 'number' }, maxItems: 300000 };
      if (valibotAction === GraphArmsSchema.entries.rig.entries.sockets.pipe[3]) return { ...jsonSchema, uniqueItems: true };
      if (valibotAction === HeldArmsSchema.options[1].entries.tools.pipe[2]) return { ...jsonSchema, uniqueItems: true };
      // This defining transform only omits empty optional namespaces; all nonempty maps retain the schema below.
      if (valibotAction === DecisionScriptsSchema.pipe[7]) return jsonSchema;
      if (valibotAction === EdgeProfileSchema.pipe[1]) {
        // Both arrays must have the same native sample count; bound each branch exactly.
        return { ...jsonSchema, anyOf: [256, 257].map(count => ({ properties: {
          heights: { minItems: count, maxItems: count }, colours: { minItems: count, maxItems: count },
        } })) };
      }
      if (valibotAction === PlumbingSchema.pipe[3]) {
        return { ...jsonSchema, 'x-wildshard-checks': ['@wildshard/format/plumbing#plumbingRules'] } satisfies FormatJsonSchema;
      }
      if (valibotAction === StateSchema.pipe[1]) {
        return { ...jsonSchema, 'x-wildshard-checks': ['@wildshard/format/state#stateRules'] } satisfies FormatJsonSchema;
      }
      if (valibotAction === CommonsCostsSchema.pipe[1]) {
        return { ...jsonSchema, maxProperties: SHARDFILE_ADMISSION_LIMITS.commons };
      }
      // Only the defining query form derives an omitted collider reference from its required sampling file.
      if (valibotAction === TerrainSchema.options[1].pipe[1]) return {
        ...jsonSchema, required: [...jsonSchema.required ?? [], 'collider'],
        'x-wildshard-checks': ['@wildshard/format/terrain#TerrainSchema.options.1.pipe.1'],
      } satisfies FormatJsonSchema;
      // The retained clip transform returns its input unchanged; identity is checked against its defining object.
      if (valibotAction === SkinClipNameSchema.pipe[2]) return jsonSchema;
      const check = wireChecks.get(valibotAction);
      if (check !== undefined) {
        const before = (jsonSchema as FormatJsonSchema)['x-wildshard-checks'] ?? [];
        return { ...jsonSchema, 'x-wildshard-checks': [...before, check] } satisfies FormatJsonSchema;
      }
      // JSON numbers cannot contain NaN or infinity. The existing ASCII regexes only use the Unicode flag.
      if (valibotAction.reference === finite || finiteNumbers.has(valibotAction) || unicodeRegexes.has(valibotAction) || wireFinite.has(valibotAction) || wireRegexes.has(valibotAction)) return jsonSchema;
      if (errors === undefined && jsonSchema.type === 'string' &&
          (valibotAction.type === 'min_length' || valibotAction.type === 'max_length')) {
        return { ...jsonSchema, 'x-wildshard-string-length': 'utf16-code-units' } satisfies FormatJsonSchema;
      }
      return undefined;
    },
  });
}

const namedSchemas = new WeakMap<GenericSchema, Readonly<Record<string, unknown>>>();
/** Build-only draft-07 structure for a named JSON producer's defining schema.
 * Like the custom-section bridge, omit documentation annotations that Ajv does
 * not implement; the producer and defining reader retain semantic admission.
 * Unknown checks and transforms still refuse conversion. Never infer from data.
 * New named JSON requests provenance: only an exact defining format root receives
 * its source identity. The default preserves every existing schema byte. */
export function namedJsonSchema(schema: GenericSchema, options: { provenance?: boolean } = {}): Readonly<Record<string, unknown>> {
  if (options.provenance === true) {
    const entry = Object.entries(wireRoots).find(([, root]) => root === schema);
    if (entry === undefined) throw new Error('Named JSON provenance requires a defining shared format root');
    const [key] = entry, split = key.indexOf('.');
    return { ...namedJsonSchema(schema), $comment: `@wildshard/format/${key.slice(0, split)}#${key.slice(split + 1)}Schema` };
  }
  const previous = namedSchemas.get(schema);
  if (previous !== undefined) return previous;
  const structural = (value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith('#/$defs/')) return value.replace('#/$defs/', '#/definitions/');
    if (Array.isArray(value)) return value.map(structural);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'x-wildshard-checks' && key !== 'x-wildshard-string-length')
      .map(([key, child]) => [key === '$defs' ? 'definitions' : key, structural(child)]));
  };
  const wire = structural(formatJsonSchema(schema, 'draft-07'));
  if (typeof wire !== 'object' || wire === null || Array.isArray(wire)) throw new Error('Named JSON requires a defining object schema');
  const result: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(wire));
  namedSchemas.set(schema, result);
  return result;
}

/** Project one registered consumer contract to its exact named draft-07 document.
 * Author tools name the contract without borrowing the format's Valibot object. */
export function namedFormatJsonSchema(name: string): Readonly<Record<string, unknown>> {
  if (!Object.hasOwn(wireRoots, name)) throw new Error(`Unknown named format contract: ${name}`);
  const schema = wireRoots[name];
  if (schema === undefined) throw new Error(`Missing named format contract: ${name}`);
  return namedJsonSchema(schema);
}

/** Build-only provenance catalogue from the defining format objects, independently checked by the product freeze. */
export function namedFormatJsonSchemas(): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return Object.fromEntries(Object.values(wireRoots).map(schema => {
    const document = namedJsonSchema(schema, { provenance: true });
    return [String(document['$comment']), document];
  }));
}

/** Publish the exact defining schema of a registered logical JSON name.
 * Only metadata changes; the caller retains the original document bytes. */
export function registeredJsonSchema(name:RegisteredSchemaJsonName):Readonly<Record<string,unknown>>;
export function registeredJsonSchema(name:string):Readonly<Record<string,unknown>>|undefined;
export function registeredJsonSchema(name:string):Readonly<Record<string,unknown>>|undefined {
  const contract=registeredJsonContract(name);
  if(contract===undefined)return undefined;
  const document=namedJsonSchema(contract.schema,{provenance:true});
  if(document['$comment']!==contract.source)throw new Error(`Registered JSON defining binding differs: ${name}`);
  return document;
}

/** The migrated wire roots, generated from their defining Valibot schemas; whole-shard extraction remains open. */
export function formatJsonSchemas(): Readonly<Record<string, FormatJsonSchema>> {
  const document = (name: string, schema: GenericSchema): FormatJsonSchema => {
    try { return {
      ...formatJsonSchema(schema), title: name,
      $comment: 'DO-NOT-EDIT: generated from @wildshard/format by scripts/gen-format-schema.mjs. Structural schema; named checks and UTF-16 bounds still require the defining Valibot parser.',
    }; } catch (error) { throw new Error(`Format schema ${name}: ${String(error)}`, { cause: error }); }
  };
  return { 'edge-profiles': document('edge-profiles', EdgeProfilesSchema), plumbing: document('plumbing', PlumbingSchema),
    state: document('state', StateSchema), 'commons-costs': document('commons-costs', CommonsCostsSchema),
    ...Object.fromEntries(Object.entries(wireRoots).map(([name, schema]) => [name, document(name, schema)])) };
}

/** JSON-only declaration discovery. Rules describe admission; this document never grants admission. */
export interface SchemaDeclaration {
  kind: string;
  rules: { kind: string; requirement?: string | number | boolean; message?: string }[];
  properties?: Record<string, SchemaDeclaration>;
  items?: SchemaDeclaration[];
  item?: SchemaDeclaration;
  alternatives?: SchemaDeclaration[];
  wrapped?: SchemaDeclaration;
  optional?: boolean;
  default?: string | number | boolean | null | object;
  value?: string | number | boolean;
  values?: (string | number | boolean)[];
  key?: SchemaDeclaration;
  valueSchema?: SchemaDeclaration;
  rest?: SchemaDeclaration;
}

function declarationOf(value: unknown): SchemaDeclaration {
  if (typeof value !== 'object' || value === null) throw new Error('Expected a defining schema');
  const read = (key: string): unknown => Reflect.get(value, key);
  const type = read('type');
  if (typeof type !== 'string') throw new Error('Expected a defining schema type');
  const pipeline = read('pipe');
  if (Array.isArray(pipeline)) {
    const schemas = pipeline.filter((part: unknown) => typeof part === 'object' && part !== null && Reflect.get(part, 'kind') === 'schema');
    const base: unknown = schemas.at(-1);
    if (base === undefined) throw new Error('Missing pipeline schema');
    const declaration = declarationOf(base);
    for (const part of pipeline) {
      if (typeof part !== 'object' || part === null || Reflect.get(part, 'kind') === 'schema') continue;
      const kind: unknown = Reflect.get(part, 'type'), requirement: unknown = Reflect.get(part, 'requirement'), message: unknown = Reflect.get(part, 'message');
      if (typeof kind !== 'string') throw new Error('Missing admission rule type');
      declaration.rules.push({ kind,
        ...(requirement instanceof RegExp ? { requirement: requirement.source } : typeof requirement === 'number' || typeof requirement === 'string' || typeof requirement === 'boolean' ? { requirement } : {}),
        ...(typeof message === 'string' ? { message } : {}),
      });
    }
    return declaration;
  }
  const declaration: SchemaDeclaration = { kind: type, rules: [] };
  const entries = read('entries'), items = read('items'), item = read('item'), alternatives = read('options'), wrapped = read('wrapped');
  if (typeof entries === 'object' && entries !== null) declaration.properties = Object.fromEntries(Object.entries(entries).map(([key, schema]) => [key, declarationOf(schema)]));
  if (Array.isArray(items)) declaration.items = items.map(declarationOf);
  if (typeof item === 'object' && item !== null) declaration.item = declarationOf(item);
  if (Array.isArray(alternatives)) {
    if (alternatives.every((option: unknown) => typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean')) declaration.values = alternatives;
    else declaration.alternatives = alternatives.map(declarationOf);
  }
  if (typeof wrapped === 'object' && wrapped !== null) declaration.wrapped = declarationOf(wrapped);
  for (const [source, target] of [['key', 'key'], ['value', 'valueSchema'], ['rest', 'rest']] as const) {
    const child = read(source);
    if (typeof child === 'object' && child !== null) declaration[target] = declarationOf(child);
  }
  if (type === 'optional' || type === 'exact_optional') declaration.optional = true;
  const fallback = read('default'), literal = read('literal');
  if (fallback === null || typeof fallback === 'string' || typeof fallback === 'number' || typeof fallback === 'boolean' || typeof fallback === 'object') declaration.default = structuredClone(fallback);
  if (typeof literal === 'string' || typeof literal === 'number' || typeof literal === 'boolean') declaration.value = literal;
  return declaration;
}

/** Inspect every defining field, tuple and union without reaching into Valibot; semantic rules remain mandatory. */
export function schemaDeclaration(schema: GenericSchema): SchemaDeclaration { return declarationOf(schema); }

/** Select an existing JSON document field by RFC 6901 pointer; malformed escapes and absent fields refuse. */
export function schemaAt(document: object, pointer = ''): unknown {
  if (pointer === '') return document;
  if (!pointer.startsWith('/')) throw new Error('Schema pointer must be empty or start with /');
  let value: unknown = document;
  for (const token of pointer.slice(1).split('/')) {
    if (/~(?![01])/u.test(token)) throw new Error('Invalid schema pointer escape');
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) throw new Error(`Unknown schema pointer: ${pointer}`);
    value = Reflect.get(value, key);
  }
  return value;
}


/** Declarative author composition; named strings resolve only defining format roots. */
export type NamedJsonComposition = string | GenericSchema
  | { readonly kind: 'number'; readonly finite?: boolean; readonly integer?: boolean; readonly safeInteger?: boolean; readonly min?: number; readonly max?: number }
  | { readonly kind: 'string'; readonly min?: number; readonly max?: number; readonly startsWith?: string; readonly regex?: RegExp }
  | { readonly kind: 'boolean' | 'unknown' | 'null' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
  | { readonly kind: 'picklist'; readonly values: readonly (string | number)[] }
  | { readonly kind: 'array'; readonly item: NamedJsonComposition; readonly min?: number; readonly max?: number; readonly length?: number }
  | { readonly kind: 'object'; readonly entries: Readonly<Record<string, NamedJsonComposition>>; readonly mode?: 'strict' | 'strip' | 'loose' }
  | { readonly kind: 'tuple'; readonly items: readonly NamedJsonComposition[] }
  | { readonly kind: 'tuple-rest'; readonly items: readonly NamedJsonComposition[]; readonly rest: NamedJsonComposition }
  | { readonly kind: 'record'; readonly key: { readonly kind: 'string'; readonly min?: number; readonly max?: number; readonly startsWith?: string; readonly regex?: RegExp }; readonly value: NamedJsonComposition; readonly maxEntries?: number }
  | { readonly kind: 'union'; readonly options: readonly NamedJsonComposition[] }
  | { readonly kind: 'variant'; readonly key: string; readonly options: readonly NamedJsonComposition[] }
  | { readonly kind: 'nullable' | 'exact-optional'; readonly item: NamedJsonComposition }
  | { readonly kind: 'optional'; readonly item: NamedJsonComposition; readonly default?: object | string | number | boolean | null };

type OptionalCompositionKeys<E extends Readonly<Record<string, NamedJsonComposition>>, M extends 'input' | 'output'> = {
  [K in keyof E]: E[K] extends { readonly kind: 'exact-optional' } ? K
    : E[K] extends { readonly kind: 'optional' } ? M extends 'input' ? K : E[K] extends { readonly default: unknown } ? never : K : never
}[keyof E];
type CompositionObjectValue<E extends Readonly<Record<string, NamedJsonComposition>>, M extends 'input' | 'output'> = {
  -readonly [K in Exclude<keyof E, OptionalCompositionKeys<E, M>>]: NamedRowValue<E[K], M>
} & { -readonly [K in OptionalCompositionKeys<E, M>]?: E[K] extends { readonly kind: 'exact-optional'; readonly item: infer I extends NamedJsonComposition } ? NamedRowValue<I, M> : NamedRowValue<E[K], M> };
type FlattenCompositionObject<T> = { [K in keyof T]: T[K] };

/** Mutable native output, retaining tuple lengths, exact optionality and literal
 * discriminants. A named format string stays opaque; an admitted native leaf
 * retains its complete defining output type. */
export type NamedRowValue<C extends NamedJsonComposition, M extends 'input' | 'output' = 'output'> = NamedJsonComposition extends C ? unknown : C extends GenericSchema ? M extends 'input' ? InferInput<C> : InferOutput<C>
  : C extends { readonly kind: 'number' } ? number
  : C extends { readonly kind: 'string' } ? string
  : C extends { readonly kind: 'boolean' } ? boolean
  : C extends { readonly kind: 'null' } ? null
  : C extends { readonly kind: 'literal'; readonly value: infer L } ? L
  : C extends { readonly kind: 'picklist'; readonly values: readonly (infer L)[] } ? L
  : C extends { readonly kind: 'array'; readonly item: infer I extends NamedJsonComposition } ? NamedRowValue<I, M>[]
  : C extends { readonly kind: 'tuple'; readonly items: infer I extends readonly NamedJsonComposition[] } ? { -readonly [K in keyof I]: NamedRowValue<I[K], M> }
  : C extends { readonly kind: 'tuple-rest'; readonly items: infer I extends readonly NamedJsonComposition[]; readonly rest: infer R extends NamedJsonComposition } ? [...{ -readonly [K in keyof I]: NamedRowValue<I[K], M> }, ...NamedRowValue<R, M>[]]
  : C extends { readonly kind: 'object'; readonly entries: infer E extends Readonly<Record<string, NamedJsonComposition>> } ? C extends { readonly mode: 'loose' } ? FlattenCompositionObject<CompositionObjectValue<E, M>> & Record<string, unknown> : FlattenCompositionObject<CompositionObjectValue<E, M>>
  : C extends { readonly kind: 'record'; readonly value: infer V extends NamedJsonComposition } ? Record<string, NamedRowValue<V, M>>
  : C extends { readonly kind: 'union' | 'variant'; readonly options: infer O extends readonly NamedJsonComposition[] } ? NamedRowValue<O[number], M>
  : C extends { readonly kind: 'nullable'; readonly item: infer I extends NamedJsonComposition } ? NamedRowValue<I, M> | null
  : C extends { readonly kind: 'exact-optional'; readonly item: infer I extends NamedJsonComposition } ? NamedRowValue<I, M> | undefined
  : C extends { readonly kind: 'optional'; readonly item: infer I extends NamedJsonComposition } ? NamedRowValue<I, M> | (M extends 'output' ? C extends { readonly default: unknown } ? never : undefined : undefined)
  : unknown;

/** Original assertion input, including native leaves that transform on parse. */
export type NamedRowInput<C extends NamedJsonComposition> = NamedRowValue<C, 'input'>;

function resolveNamedComposition(node: NamedJsonComposition): GenericSchema {
  if (typeof node === 'string') {
    if (!Object.hasOwn(wireRoots, node)) throw new Error(`Unknown named format contract: ${node}`);
    const root = wireRoots[node];
    if (root === undefined) throw new Error(`Missing named format contract: ${node}`);
    return root;
  }
  switch (node.kind) {
    case 'schema': return node;
    case 'number': {
      let schema: GenericSchema<unknown, number> = number();
      if (node.finite === true) schema = pipe(schema, finite());
      if (node.integer === true) schema = pipe(schema, integer());
      if (node.safeInteger === true) schema = pipe(schema, safeInteger());
      if (node.min !== undefined) schema = pipe(schema, minValue(node.min));
      if (node.max !== undefined) schema = pipe(schema, maxValue(node.max));
      return schema;
    }
    case 'string': {
      let schema: GenericSchema<unknown, string> = string();
      if (node.min !== undefined) schema = pipe(schema, minLength(node.min));
      if (node.max !== undefined) schema = pipe(schema, maxLength(node.max));
      if (node.startsWith !== undefined) schema = pipe(schema, startsWith(node.startsWith));
      if (node.regex !== undefined) schema = pipe(schema, sourceRegex(node.regex));
      return schema;
    }
    case 'boolean': return boolean();
    case 'unknown': return unknown();
    case 'null': return nullSchema();
    case 'literal': {
      if (typeof node.value === 'number' && !Number.isFinite(node.value)) throw new Error('Named JSON literal must be finite');
      return node.value === null ? nullSchema() : literalSchema(node.value);
    }
    case 'picklist': return picklist(node.values);
    case 'array': {
      let schema: GenericSchema<unknown, unknown[]> = array(resolveNamedComposition(node.item));
      if (node.min !== undefined) schema = pipe(schema, minLength(node.min));
      if (node.max !== undefined) schema = pipe(schema, maxLength(node.max));
      if (node.length !== undefined) schema = pipe(schema, length(node.length));
      return schema;
    }
    case 'tuple': return tuple(node.items.map(resolveNamedComposition));
    case 'tuple-rest': return tupleWithRest(node.items.map(resolveNamedComposition), resolveNamedComposition(node.rest));
    case 'object': {
      const entries = Object.fromEntries(Object.entries(node.entries).map(([name, item]) => [name, resolveNamedComposition(item)]));
      return node.mode === 'strip' ? object(entries) : node.mode === 'loose' ? looseObject(entries) : strictObject(entries);
    }
    case 'record': {
      const schema = record(resolveNamedComposition(node.key) as GenericSchema<string, string>, resolveNamedComposition(node.value));
      return node.maxEntries === undefined ? schema : pipe(schema, maxEntries(node.maxEntries));
    }
    case 'union': return union(node.options.map(resolveNamedComposition));
    case 'variant': return variant(node.key, node.options.map(resolveNamedComposition) as VariantOptions<string>);
    case 'nullable': return nullable(resolveNamedComposition(node.item));
    case 'exact-optional': return exactOptional(resolveNamedComposition(node.item));
    case 'optional': return optional(resolveNamedComposition(node.item), node.default);
    default: throw new Error('Unknown named row composition');
  }
}

/** One compiled source contract, with complete native admission and the exact
 * wire schema from that same grammar. Custom checks stay author-side; asking
 * for their wire schema still refuses unless the defining bridge knows them. */
export interface NamedRows<T = unknown, I = T> {
  readonly schema: GenericSchema<I, T>;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  readonly parse: (input: unknown) => T;
  /** Preserve native non-throwing parsed output and complete validation issues. */
  readonly safeParse: (input: unknown) => SafeParseResult<GenericSchema<I, T>>;
  /** Validate and retain the original object, including unknown stripped fields. */
  readonly admit: (input: unknown) => I;
  /** Non-throwing native admission for callers retaining their own error text. */
  readonly accepts: (input: unknown) => input is I;
}

/** Compile a source-owned finite grammar once, before validating or emitting
 * any rows. The recursive output mapping mirrors each native compiler branch;
 * no input value is cast to its admitted output type. */
export function defineNamedRows<const C extends NamedJsonComposition>(composition: C,
  refinement?: (value: NamedRowValue<C>) => boolean, message?: string): NamedRows<NamedRowValue<C>, NamedRowInput<C>> {
  const native = resolveNamedComposition(composition) as GenericSchema<NamedRowInput<C>, NamedRowValue<C>>;
  const schema = refinement === undefined ? native : pipe(native, sourceCheck(refinement, message));
  return { schema, parse: rowsValue => parse(schema, rowsValue), safeParse: rowsValue => sourceSafeParse(schema, rowsValue), admit: rowsValue => { assert(schema, rowsValue); return rowsValue; },
    accepts: (rowsValue): rowsValue is NamedRowInput<C> => sourceIs(schema, rowsValue), get jsonSchema() { return namedJsonSchema(schema); } };
}

/** Compose defining roots and local structural leaves without exporting runtime consumer schemas.
 * Conversion keeps the ordinary unknown-check/transform refusals and never infers a contract from data. */
export function composeNamedJsonSchema(composition: NamedJsonComposition): Readonly<Record<string, unknown>> {
  return namedJsonSchema(resolveNamedComposition(composition));
}

/** Exact defining pure-format objects for checked author compositions. */
interface AuthorFormatObjects {
  readonly 'nativePhysics.nativeGroundRecordSchema': typeof nativeGroundRecordSchema;
  readonly 'ambientLife.ForagerContinuation': typeof ForagerContinuation;
  readonly 'riding.ClientRidingSessionSchema': typeof ClientRidingSessionSchema;
  readonly 'mountedSpecimenRows.MountedSpecimenSeatSchema': typeof MountedSpecimenSeatSchema;
  readonly 'lootEconomy.ClaimedPickupSchema': typeof ClaimedPickupSchema;
  readonly 'lootBag.LootBagSchema': typeof LootBagSchema;
  readonly 'questContinuation.QuestContinuationSchema': typeof QuestContinuationSchema;
  readonly 'npcs.QuestNpcBindingsSchema': typeof QuestNpcBindingsSchema;
  readonly 'questHost.QuestHostSchema': typeof QuestHostSchema;
  readonly 'speciesBookRows.CreatureGuestSchema': typeof CreatureGuestSchema;
  readonly 'speciesBookRows.SpeciesLookBookSchema': typeof SpeciesLookBookSchema;
  readonly 'paintedLook.PaintedLookSchema': typeof PaintedLookSchema;
  readonly 'materials.MaterialsSchema': typeof MaterialsSchema;
  readonly 'sceneDressing.SceneDressingSchema': typeof SceneDressingSchema;
  readonly 'sceneDressing.SceneScatterPageSchema': typeof SceneScatterPageSchema;
  readonly 'sceneDressing.SceneBakedGeometrySchema': typeof SceneBakedGeometrySchema;
  readonly 'sceneDressing.SceneFloorSchema': typeof SceneFloorSchema;
  readonly 'sceneDressing.SceneDressingContactsSchema': typeof SceneDressingContactsSchema;
  readonly 'specimenCatalogue.SpecimenCatalogueSchema': typeof SpecimenCatalogueSchema;
  readonly 'specimenCatalogue.PackedSpecimenSchema': typeof PackedSpecimenSchema;
  readonly 'specimenCatalogue.SpecimenMaterialSchema': typeof SpecimenMaterialSchema;
  readonly 'specimenCatalogue.SpecimenAssetSchema': typeof SpecimenAssetSchema;
  readonly 'ambientLife.AmbientFlockSchema': typeof AmbientFlockSchema;
  readonly 'ambientLife.AmbientPerchesSchema': typeof AmbientPerchesSchema;
  readonly 'clientChannels.PrivateSceneSchema': typeof PrivateSceneSchema;
  readonly 'collectionDisplay.CollectionDisplaysSchema': typeof CollectionDisplaysSchema;
  readonly 'bodySlots.BodySlotsSchema': typeof BodySlotsSchema;
  readonly 'bakedTiles.BakedTilesSchema': typeof BakedTilesSchema;
  readonly 'populationProjection.PopulationProjectionSchema': typeof PopulationProjectionSchema;
  readonly 'populationProjection.EnemyPlacementsSchema': typeof EnemyPlacementsSchema;
  readonly 'populationKeeper.PopulationKeeperRowsSchema': typeof PopulationKeeperRowsSchema;
  readonly 'scalarChannel.ScalarTripletSchema': typeof ScalarTripletSchema;
  readonly 'scalarChannel.ScalarLatticeSchema': typeof ScalarLatticeSchema;
  readonly 'terrain.GroundRowsSchema': typeof GroundRowsSchema;
  readonly 'questFigures.KitFigureCardsSchema': typeof KitFigureCardsSchema;
  readonly 'questFigures.QuestFiguresSchema': typeof QuestFiguresSchema;
  readonly 'catalogueEconomy.CatalogueEconomySchema': typeof CatalogueEconomySchema;
  readonly 'minimap.ManifestMetadataSchema': typeof ManifestMetadataSchema;
  readonly 'islandLibrary.ResolvedIslandLibrarySchema': typeof ResolvedIslandLibrarySchema;
  readonly 'islandLibrary.FixedGeometryGroupsSchema': typeof FixedGeometryGroupsSchema;
  readonly 'practiceCourseRows.FixedPracticeFileSchema': typeof FixedPracticeFileSchema;
  readonly 'mixedPopulation.MixedPopulationSchema': typeof MixedPopulationSchema;
  readonly 'nativeQuestComposition.NativeQuestCompositionSchema': typeof NativeQuestCompositionSchema;
  readonly 'namedJsonContracts.HEADLESS_ASSEMBLY_JSON_SCHEMA': typeof HEADLESS_ASSEMBLY_JSON_SCHEMA;
  readonly 'namedJsonContracts.ReturnProgramSchema': typeof ReturnProgramSchema;
  readonly 'namedJsonContracts.PageReturnRowsSchema': typeof PageReturnRowsSchema;
  readonly 'namedJsonContracts.QuestTraderSchema': typeof QuestTraderSchema;
  readonly 'namedJsonContracts.PosedLibrarySchema': typeof PosedLibrarySchema;
  readonly 'npcs.QuestPageTalksSchema': typeof QuestPageTalksSchema;
  readonly 'contracts.ContractBoardPageSchema': typeof ContractBoardPageSchema;
  readonly 'practiceCourseRows.PracticeSceneSchema': typeof PracticeSceneSchema;
  readonly 'practiceCourseRows.PracticeControllerSchema': typeof PracticeControllerSchema;
  readonly 'nativePhysics.nativeBodySchema': typeof nativeBodySchema;
  readonly 'nativePhysics.nativeColliderRecordSchema': typeof nativeColliderRecordSchema;
}
const authorFormats: AuthorFormatObjects = {
  'nativePhysics.nativeGroundRecordSchema': nativeGroundRecordSchema,
  'ambientLife.ForagerContinuation': ForagerContinuation,
  'riding.ClientRidingSessionSchema': ClientRidingSessionSchema,
  'mountedSpecimenRows.MountedSpecimenSeatSchema': MountedSpecimenSeatSchema,
  'lootEconomy.ClaimedPickupSchema': ClaimedPickupSchema,
  'lootBag.LootBagSchema': LootBagSchema,
  'questContinuation.QuestContinuationSchema': QuestContinuationSchema,
  'npcs.QuestNpcBindingsSchema': QuestNpcBindingsSchema,
  'questHost.QuestHostSchema': QuestHostSchema,
  'speciesBookRows.CreatureGuestSchema': CreatureGuestSchema,
  'speciesBookRows.SpeciesLookBookSchema': SpeciesLookBookSchema,
  'paintedLook.PaintedLookSchema': PaintedLookSchema,
  'materials.MaterialsSchema': MaterialsSchema,
  'sceneDressing.SceneDressingSchema': SceneDressingSchema,
  'sceneDressing.SceneScatterPageSchema': SceneScatterPageSchema,
  'sceneDressing.SceneBakedGeometrySchema': SceneBakedGeometrySchema,
  'sceneDressing.SceneFloorSchema': SceneFloorSchema,
  'sceneDressing.SceneDressingContactsSchema': SceneDressingContactsSchema,
  'specimenCatalogue.SpecimenCatalogueSchema': SpecimenCatalogueSchema,
  'specimenCatalogue.PackedSpecimenSchema': PackedSpecimenSchema,
  'specimenCatalogue.SpecimenMaterialSchema': SpecimenMaterialSchema,
  'specimenCatalogue.SpecimenAssetSchema': SpecimenAssetSchema,
  'ambientLife.AmbientFlockSchema': AmbientFlockSchema,
  'ambientLife.AmbientPerchesSchema': AmbientPerchesSchema,
  'clientChannels.PrivateSceneSchema': PrivateSceneSchema,
  'collectionDisplay.CollectionDisplaysSchema': CollectionDisplaysSchema,
  'bodySlots.BodySlotsSchema': BodySlotsSchema,
  'bakedTiles.BakedTilesSchema': BakedTilesSchema,
  'populationProjection.PopulationProjectionSchema': PopulationProjectionSchema,
  'populationProjection.EnemyPlacementsSchema': EnemyPlacementsSchema,
  'populationKeeper.PopulationKeeperRowsSchema': PopulationKeeperRowsSchema,
  'scalarChannel.ScalarTripletSchema': ScalarTripletSchema,
  'scalarChannel.ScalarLatticeSchema': ScalarLatticeSchema,
  'terrain.GroundRowsSchema': GroundRowsSchema,
  'questFigures.KitFigureCardsSchema': KitFigureCardsSchema,
  'questFigures.QuestFiguresSchema': QuestFiguresSchema,
  'catalogueEconomy.CatalogueEconomySchema': CatalogueEconomySchema,
  'minimap.ManifestMetadataSchema': ManifestMetadataSchema,
  'islandLibrary.ResolvedIslandLibrarySchema': ResolvedIslandLibrarySchema,
  'islandLibrary.FixedGeometryGroupsSchema': FixedGeometryGroupsSchema,
  'practiceCourseRows.FixedPracticeFileSchema': FixedPracticeFileSchema,
  'mixedPopulation.MixedPopulationSchema': MixedPopulationSchema,
  'nativeQuestComposition.NativeQuestCompositionSchema': NativeQuestCompositionSchema,
  'namedJsonContracts.HEADLESS_ASSEMBLY_JSON_SCHEMA': HEADLESS_ASSEMBLY_JSON_SCHEMA,
  'namedJsonContracts.ReturnProgramSchema': ReturnProgramSchema,
  'namedJsonContracts.PageReturnRowsSchema': PageReturnRowsSchema,
  'namedJsonContracts.QuestTraderSchema': QuestTraderSchema,
  'namedJsonContracts.PosedLibrarySchema': PosedLibrarySchema,
  'npcs.QuestPageTalksSchema': QuestPageTalksSchema,
  'contracts.ContractBoardPageSchema': ContractBoardPageSchema,
  'practiceCourseRows.PracticeSceneSchema': PracticeSceneSchema,
  'practiceCourseRows.PracticeControllerSchema': PracticeControllerSchema,
  'nativePhysics.nativeBodySchema': nativeBodySchema,
  'nativePhysics.nativeColliderRecordSchema': nativeColliderRecordSchema,
};
/** Select a defining validator, pure grammar factory or structural document by its finite module/export identity.
 * The original object, exact type, custom checks and metadata identity are retained;
 * no engine/game runtime binding or unregistered dynamic grammar is borrowed. */
export function authorFormatSchema<Name extends keyof AuthorFormatObjects>(name: Name): AuthorFormatObjects[Name] {
  if (!Object.hasOwn(authorFormats, name)) throw new Error(`Unknown author format: ${name}`);
  return authorFormats[name];
}

/** Finite validator identities; factories and structural documents are not admission grammars. */
type AuthorSchemaName = { [Name in keyof AuthorFormatObjects]: AuthorFormatObjects[Name] extends GenericSchema ? Name : never }[keyof AuthorFormatObjects];

/** Admit author data through its original defining validator, preserving defaults,
 * custom checks, transforms and issue ordering. No ad-hoc schema or runtime service is accepted. */
export function authorFormatRows<Name extends AuthorSchemaName>(name: Name, rowsValue: unknown): InferOutput<AuthorFormatObjects[Name]> {
  const schema = authorFormatSchema(name);
  if (schema.kind !== 'schema') throw new Error('Author admission requires a validator');
  return parse(schema, rowsValue);
}

/** Admit every explicitly named catalogue member through its defining format.
 * Key order and native member defaults/checks remain; missing or extra members refuse. */
export function authorCatalogueRows<Name extends AuthorSchemaName, const Keys extends readonly string[]>(name: Name, keys: Keys,
  rowsValue: unknown): Record<Keys[number], InferOutput<AuthorFormatObjects[Name]>>;
export function authorCatalogueRows(name: AuthorSchemaName, keys: readonly string[], rowsValue: unknown): Record<string, unknown> {
  if (keys.length > 1024 || new Set(keys).size !== keys.length
    || keys.some(key => typeof key !== 'string' || key === '' || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Invalid author catalogue keys');
  const schema = authorFormatSchema(name);
  if (schema.kind !== 'schema') throw new Error('Author catalogue requires a validator');
  const entries = Object.fromEntries<GenericSchema>(keys.map(key => [key, schema]));
  return parse(strictObject(entries), rowsValue);
}

/** Admit authored native collider arrays with the defining shape/provenance
 * checks and original file-slice storage. No decoding or runtime service. */
export function nativeColliderSourceRows<const S extends readonly (1 | 2 | 6 | 9)[]>(rowsValue: unknown, shapes: S,
  owner: 'piece' | 'tagged'): NativeColliderRecord<S[number], NativeArrayStorage>[] {
  return parse(array(nativeColliderRecordSchema(shapes, owner, true)), rowsValue);
}
