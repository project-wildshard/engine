import { installNalatiSpeciesFixture } from './nalati-species-world';
/** Explicit opt-in for tests exercising installed world content. Pure tests never import this fixture. */
import * as v from 'valibot';
import perchRows from '../../src/shards/driftwood-isle/data/mixedPopulation.json' with { type: 'json' };
import { Scope } from '../../src/shared/engine/app/scope';
import { prepareNativeScalarBlocks } from '../../scripts/bake/nativeWorld.mjs';
import { nalatiNativeGeography } from './nalati-native-program';
import { pineDensityBlob } from '../../src/shards/pine-hollow/generators/forestRows';
import pineManifest from '../../src/shards/pine-hollow/manifest.json' with { type: 'json' };
import { installAssetFixture, installCatalogueFixture } from './bootSetup';
// oxlint-disable-next-line import/no-nodejs-modules -- The shared pickup fixture reads its explicitly declared public assets.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Decode the exact pinned original lane-shuffled stream.
import { inflateSync } from 'node:zlib';

let installed: Promise<void> | undefined;
/** Explicit opt-in; repeated requests in one isolated test file share the same world. */
export function installWorldFixture(): Promise<void> { return installed ??= prepareWorld(); }

async function prepareWorld(): Promise<void> {
  await installAssetFixture();
  await installCatalogueFixture();
  // Only full world consumers initialize the compatibility level.
  await import('./shardList');
  const {shards:scalarDefinitions}=await import('../../src/client/game/shard/list');
  for (const definition of scalarDefinitions()) {
    const intake = definition.scalarBlocks;
    if (definition.slug === 'nalati-grasslands' && intake !== undefined && !intake.prepared) {
      const sources = await nalatiNativeGeography();
      intake.prepare(new Map(intake.files.map(file => {
        const bytes = sources.get(file);
        if (bytes === undefined) throw new Error(`Missing owned Nalati scalar source: ${file}`);
        return [file, bytes];
      })));
    } else if (definition.slug === 'pine-hollow' && intake !== undefined && !intake.prepared) {
      const density = pineDensityBlob(pineManifest);
      intake.prepare(new Map([[density.name, density.bytes]]));
    }
    prepareNativeScalarBlocks(definition, process.cwd());
  }
  const { registerAchievements } = await import('../../src/shared/game/achievements');
  const { PINE_FEATS } = await import('../../src/shards/pine-hollow/generators/questInventory');
  const { DRIFTWOOD_ITEMS, DRIFTWOOD_FEATS } = await import('../../src/shards/driftwood-isle/generators/questInventory');
  registerAchievements('pine-hollow', PINE_FEATS);
  registerAchievements('driftwood-isle', DRIFTWOOD_FEATS);

  // The composition root owns shared species; the engine has no upward kit import.
  (await import('../../src/client/engine/world/registry')).installWorldRegistry(); // the session installs it in the game
  const { registerSpecies } = await import('../../src/shared/engine/entities/species/registry');
  const { speciesWithLook } = await import('../../src/client/engine/entities/species/look');
  const { installScore } = await import('../../src/client/engine/audio/score/score');
  const { WILDSHARD_SCORE } = await import('../../src/client/game/audio/theme');
  installScore(WILDSHARD_SCORE);
  const { installKitSpecies } = await import('../../src/client/game/systems/species/install');
  const { installKitIcons } = await import('../../src/client/game/icons');
  const { installPickupCatalogue, preparePickupCatalogue } = await import('../../src/client/game/models/specimenCatalogue');
  const { default: PICKUP_CATALOGUE } = await import('../../src/client/game/data/pickupCatalogue.json');
  const { installKitProps } = await import('../../src/client/game/models/interact');
  installKitSpecies();
  installKitIcons();
  installPickupCatalogue(PICKUP_CATALOGUE, await preparePickupCatalogue({ file: name => Promise.resolve(new Uint8Array(readFileSync(`public${name}`))) }, PICKUP_CATALOGUE));
  installKitProps();
  const { registerLootTable } = await import('../../src/client/game/loot/tables');
  const { readLootTables } = await import('../../src/shared/game/loot/tableRows');
  const { DRIFTWOOD_LOOT: loot } = await import('../../src/shards/driftwood-isle/generators/loot');
  for (const row of readLootTables(loot.economy.tables)) registerLootTable(row);
  const { DRIFTWOOD_LOOKS } = await import('../fake/driftwoodLooks');
  const { DRIFTWOOD_SPECIES } = await import('../fake/driftwoodSpecies');
  const { MONKEY_CLIPS } = await import('../../src/shards/driftwood-isle/generators/monkeyClips');
  const { PerchBodyBinding } = await import('@wildshard/engine/game/population/perchBody');
  const { RETURN_PROGRAM } = await import('./driftwood-guest-programs');
  const {lendDriftwoodReturns}=await import('./driftwood-return-modules');
  const monkeyAnimate = new PerchBodyBinding({ clips: MONKEY_CLIPS, program: RETURN_PROGRAM, perch: perchRows.perch }, lendDriftwoodReturns(new Scope('fixture.monkey'))).animate;
  for (let i = 0; i < DRIFTWOOD_SPECIES.length; i++) {
    const row = DRIFTWOOD_SPECIES[i], look = DRIFTWOOD_LOOKS[i];
    if (row !== undefined && look !== undefined) registerSpecies(speciesWithLook(row, look.kind === 'monkey' ? { ...look, animate: monkeyAnimate } : look));
  }
  await installNalatiSpeciesFixture();
  const { unshuffleLanes: unshuffleBodyLanes } = await import('../../src/client/engine/core/deflate');
  // and its camps' and bridge's places bake (world/placeBake.ts)
  const { SHAPES, SHAPE_BYTES } = await import('./nalatiShapes');
  const { originalPlaceBinary } = await import('./nalati-original-place-binary');
  if (!SHAPES.ready) await SHAPES.load(new Map([...SHAPE_BYTES, ['/assets/nalati/baked/places.bin', unshuffleBodyLanes(new Uint8Array(inflateSync(await originalPlaceBinary())))]]));
  // Legacy fixtures include Pine's spawn-only thrall, without activating a rendered level.
  const { PINE_BOAR } = await import('../../src/shards/pine-hollow/generators/speciesRows');
  const { HullLookBook } = await import('../../src/client/game/looks/speciesBook');
  const { SPECIES_LOOKS } = await import('../../src/shards/pine-hollow/generators/nativeView');
  const pineBook = new HullLookBook(SPECIES_LOOKS);
  const { THRALL_CLIPS } = await import('../../src/shards/pine-hollow/generators/thrallClips');
  const { numericCreaturePose } = await import('../../src/shared/game/plugin/channelPrograms');
  registerSpecies(speciesWithLook(PINE_BOAR, { ...pineBook.look('boar'), postPose: numericCreaturePose(THRALL_CLIPS) }));
  // and its elk thrall (E405: Pine's, derived from the kit's elk)
  const { pineElk } = await import('../../src/shards/pine-hollow/generators/speciesRows');
  registerSpecies(speciesWithLook(pineElk(), pineBook.look('elk')));
  // Pure inventory fixtures explicitly install the authored item catalogs.
  const { registerItemRow } = await import('../../src/shared/game/bag/itemCatalog');
  const { default: starterItems } = await import('../../src/shared/game/bag/starterItems.json');
  const STARTER_BAG_ITEMS = v.parse(v.array(v.object({ id: v.string(), label: v.string(), icon: v.picklist(['meat', 'hide', 'tusk', 'antlers']), travels: v.boolean() })), starterItems);
  const { PINE_BAG_ITEMS: PINE_ITEMS } = await import('../../src/shards/pine-hollow/generators/questInventory');
  for (const row of [...STARTER_BAG_ITEMS, ...PINE_ITEMS, ...DRIFTWOOD_ITEMS]) registerItemRow(row);
}
