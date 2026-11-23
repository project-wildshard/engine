import baked from '../../../../test/pins/catalogue.json' with { type: 'json' };
import { installedCatalogue, type CatalogueDocument } from './catalogueSlot';

/** Each reader asks here, at call time, never at import. ONE-FORMAT OF31i3 (R3): with none installed, a Node tool, a test or a
 * page with no bake reads the pinned channel catalogue (`test/pins/catalogue.json`, api-server's `/api/catalogue.json` as the pins
 * hold it); no grid lives in `src/`. */
export function catalogueDocument(): CatalogueDocument { return installedCatalogue() ?? baked; }
