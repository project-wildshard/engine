// G450 §5: output sections supply the defining host exports as G294 roots.
// This is a census table, not a runtime installer. No authoring import supplies
// a runtime user. Metadata-only sections have no independent executable host.
const hosts = {
  'explore/catalogue': ['game/client/models/explorerCatalogue#explorerRoster'],
  'collections/displays': ['game/client/models/collectionDisplay#CollectionCatalogue'],
  'models/island-library': ['game/client/models/islandLibrary#IslandLibrary'],
  'world/trees': ['game/client/models/treeSet#productTreeSet', 'game/client/shardfile/forestPage#placeForestPageModels'],
  'look/rigged-hulls': ['game/client/looks/riggedHulls#productRiggedHulls'],
  'look/hull-book': ['game/client/looks/speciesBook#productHullBook'],
  'look/painted': ['game/client/looks/paintedLook#productPaintedLook'],
  'look/colour-functions': ['engine/client/render/graph/colourFunction#materialColourGraph'],
  'look/toon': ['game/client/looks/toonLook#toonLook'],
  'client/plan': ['game/client/shardfile/clientPlan#installClientPhase', 'game/client/shard/declaredEntry#declaredRuntimeEntry'],
  'world/tiles': ['game/client/shardfile/clientViews#clientTileViews'],
  'world/terrain': ['game/shared/shardfile/clientGround#clientGround'],
  'world/edge': ['game/shared/shardfile/portalTraversal#createPortalTraversal'],
  'world/collision': ['game/shared/shardfile/collisionBindings#installShardfileColliders'],
  'world/navigation': ['game/client/shardfile/productNavigation#installProductNavigation'],
  'world/props': ['game/shared/shardfile/props#propColliderDescriptors'],
  'world/water': ['game/client/shardfile/clientWater#installClientWater', 'game/client/shardfile/water#shardfileWater'],
  'world/movers': ['game/server/plugin/mover#createComposedMoverHost', 'game/client/shardfile/clientMoverOwners#installClientMoverOwners'],
  'world/traversal': ['game/shared/shardfile/portalTraversal#createPortalTraversal'],
  'world/spawn': [], // Level admission metadata.
  'world/physics': [], // Handed to the runtime's explicitly imported native host.
  'world/days': ['game/shared/shard/declaredRows#declaredDay'],
  'world/weather': ['game/shared/shard/declaredRows#declaredWeather'],
  'look/look': ['game/client/shardfile/look#shardfileLook'],
  'look/map': ['game/client/shardfile/mapImage#reserveMapImage'],
  'look/materials': ['game/client/shardfile/clientMaterials#clientMaterials'],
  'look/keyed-sky': ['game/client/looks/keyedSky#keyedSkyBackdrop'],
  'actors/spawn-scripts': ['game/server/population/spawnScript#SpawnScript', 'format/spawnScripts#parseSpawnScript'],
  'player/stealth': ['game/client/stealth/controller#StealthController', 'format/stealth#StealthRowsSchema'],
  'view/modules': ['format/scriptContract#ViewModulesSchema', 'format/scriptContract#admitScriptContract'],
  'actors/return-scripts': ['game/shared/population/returnProgram#ReturnProgram', 'format/decisionScripts#parseDecisionScripts'],
  'actors/moves': ['engine/server/ai/moves#ActorMoveRunner', 'format/actorMoves#parseActorMoves'],
  'actors/creatures': ['game/server/shardfile/brainRuntime#installDeclaredBrains'],
  'actors/crowds': ['game/shared/shardfile/crowdRuntime#prepareDeclaredCrowds'],
  'actors/npcs': ['game/server/plugin/simulation#installDeclaredQuestHost'],
  'actors/species': ['game/server/plugin/brain#speciesResolver', 'game/client/shardfile/clientRecipes#clientSpeciesLooks'],
  'actors/spawns': ['game/server/shardfile/brainRuntime#installDeclaredBrains'],
  'actors/strikes': [], // Consumed by the runtime's explicitly imported creature host.
  'actors/species-programs': [], // Metadata lent to existing page/native species and hunt owners.
  'held/arms': ['game/client/loadout/claims#HeldClaims', 'game/client/systems/viewmodel/heldView#HeldView'],
  'held/equipment': ['game/client/plugin/heldEquipment#HeldEquipment'],
  'held/loadout': ['game/client/loadout/held#installHeldLoadout'],
  'held/finishes': ['game/client/loadout/finishes#HeldFinishes'],
  'held/gear': ['game/client/models/heldGear#heldGear'],
  'combat/items': ['game/server/shardfile/items#installDeclaredItems'],
  'combat/encounters': ['game/server/plugin/simulation#createShardfileSim'],
  'combat/strikes': ['game/server/plugin/simulation#createShardfileSim'],
  'quests/quests': ['game/shared/quest/declared#DeclaredQuests'],
  'quests/host': ['game/server/plugin/simulation#installDeclaredQuestHost'],
  'quests/directors': ['game/shardfile/directorClient#installDeclaredDirector'],
  'economy/ledger': ['game/shared/ledger#Ledger', 'game/shared/ledger#installLedgerEmitter'],
  'economy/loot': ['game/shared/shard/declaredRows#declaredLootPresentation'],
  'state/state': ['game/server/shardfile/scripts#numericScriptState'],
  'state/migrations': ['game/shared/shardfile/logicalState#logicalStateFromLane'],
  'state/modes': ['engine/shared/player/modes#playerModes'],
  'sim/runtime-plan': ['game/server/shardfile/nativePlan#prepareProductRuntimePlan'],
  'world/scenes': ['game/client/shardfile/worldScenes#installWorldScenes'],
  'world/targets': ['game/shared/shardfile/worldTargets#WorldTargetHost'],
  'sim/scripts': ['engine/server/script/decision#DecisionHost', 'format/decisionScripts#parseDecisionScripts'],
  'sim/bodies': ['game/server/quest/bodyOps#DeclaredBodyOps', 'format/bodySlots#DeclaredBodyOpsSchema'],
  'sim/sim': ['game/server/shardfile/scripts#createShardfileScriptLane'],
  'sim/hooks': ['game/server/shardfile/scripts#createShardfileScriptLane'],
  'sim/client-scripts': ['game/client/shardfile/clientScripts#createShardfileClientScripts'],
  'sim/client-channels': ['game/client/plugin/ui#ClientScriptViews'],
  'sim/plumbing': ['game/client/shard/declaredPlumbing#installDeclaredPlumbing'],
  'audio/audio': ['engine/client/audio/declared#installDeclaredAudio'],
  'ui/card': [], // Discovery metadata; no per-shard executable implementation.
  'ui/level': [],
  'ui/ui': ['game/client/shard/declaredUi#mountDeclaredUi', 'game/client/shard/declaredTargets#installDeclaredTargets'],
  'ui/compendium': ['game/shared/shard/declaredRows#declaredProductCompendium'],
  'ui/completion': ['game/client/complete/declared#installCompletion'],
  'ui/strings': [], // Read by an explicitly imported consumer, not executed.
};

/** A synthetic import list seeds named reach without becoming counted code.
 * Unknown platform sections refuse so a new host cannot disappear from G294.
 * @param {readonly {name:string}[]} sections @param {string} sourcePrefix */
export function sectionHostImports(sections, sourcePrefix = '../../src/') {
  const roots = new Set();
  for (const section of sections) {
    if (section.name.startsWith('custom/')) continue;
    if (!Object.hasOwn(hosts, section.name)) throw new Error(`No output host attribution: ${section.name}`);
    for (const host of hosts[section.name]) roots.add(host);
  }
  return [...roots].sort((a,b)=>a.localeCompare(b)).map((host, i) => {
    const [module, name] = host.split('#');
    return `import { ${name} as host${i} } from '${module.startsWith('format/') ? '@wildshard/' : sourcePrefix}${module}'; void host${i};`;
  }).join('\n');
}
