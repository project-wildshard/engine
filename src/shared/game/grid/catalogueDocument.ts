import baked from './singleplayer.json' with { type: 'json' };
import { installedCatalogue, type CatalogueDocument } from './catalogueSlot';

/** Each reader asks here, at call time, never at import. The JSON beside this file is what a Node tool, a test or a page
 * with no bake reads: the first party's grid until `api-server` production owns it. */
export function catalogueDocument(): CatalogueDocument { return installedCatalogue() ?? baked; }
