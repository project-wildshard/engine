// A real bundled grid before the later channel placement file extends it.
// Keep the selected pins' metadata, but a new staging placement cannot
// retroactively become part of the older build these tests exercise.
import {readFileSync} from 'node:fs';
import {parseStandaloneCatalogue, type StandaloneCatalogue} from '../../src/scripts/standalone-catalogue.ts';
import bundled from '../../test/pins/catalogue.json' with {type: 'json'};

const selected = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as StandaloneCatalogue;
export const catalogueBeforePlacements = parseStandaloneCatalogue({...selected, grid: bundled.grid});
