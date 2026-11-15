import { parseSpawnScript } from '@wildshard/format/spawnScripts';
import { frozenNalatiJson, frozenNalatiBytes } from './nalati';
import { looseObject, parse, unknown } from 'valibot';
const {compiled, ...rows} = parse(looseObject({compiled: unknown()}), frozenNalatiJson('nalati-charge.json'));
export const frozenCharge = parseSpawnScript(rows);
export const frozenChargeModule = frozenNalatiBytes('nalati-charge.wasm');
