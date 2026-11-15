// A real bundled grid before the later channel placement file extends it.
// Keep the selected pins' metadata, but a new staging placement cannot
// retroactively become part of the older build these tests exercise.
import {readFileSync} from 'node:fs';
import * as v from 'valibot';
import {StandaloneCatalogueSchema, type StandaloneCatalogue} from '@wildshard/format/standaloneCatalogue';
import bundled from '../../src/shared/game/grid/singleplayer.json' with {type: 'json'};

const selected = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as StandaloneCatalogue;
export const catalogueBeforePlacements = v.parse(StandaloneCatalogueSchema, {...selected, grid: bundled.grid});
