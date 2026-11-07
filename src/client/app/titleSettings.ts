import { prepareAssetTables } from './assetTables';

interface TitleSettingsPreparation {
  readonly inventory: () => Promise<unknown>;
  readonly registry: () => Promise<unknown>;
}
const titlePreparation: TitleSettingsPreparation = { inventory: prepareAssetTables, registry: async () => (await import('./shardSelection')).completeCatalogue() };

/** The renderer-free title has not selected an entry. Settings still reads
 * shipped audio credits, so admit its exact common inventory before opening.
 * Packs and gameplay stay deferred until their existing owners request them. */
export async function openTitleSettings(open: () => void, preparation: TitleSettingsPreparation = titlePreparation): Promise<void> {
  await Promise.all([preparation.inventory(), preparation.registry()]);
  open();
}
