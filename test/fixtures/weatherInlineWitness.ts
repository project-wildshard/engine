// ZONE-SNAPSHOTS ZS9 (J507): Nalati's live weather reactions, their guest and the night's parameters, from the live pin.
import { liveJson, livePath } from './livePin';
import { liveNight as NALATI_NIGHT } from './liveNalati';
import * as v from 'valibot';
import {WeatherReactionsSchema} from '@wildshard/format/weatherProgram';
import {DecisionScriptsSchema} from '@wildshard/format/decisionScripts';
import {sha256} from '../../src/shared/game/plugin/moduleHash';

const raw=v.parse(v.object({...WeatherReactionsSchema.entries,script:DecisionScriptsSchema.pipe[2].item}),
  v.parse(v.object({reactions:v.unknown()}),liveJson('nalati-grasslands','world/weather.json')).reactions);
export const weatherModuleBytes=livePath('nalati-grasslands',raw.script.module);
if(raw.script.module!==`blobs/wasm/${sha256(weatherModuleBytes)}.wasm`)throw new Error('Weather witness hash mismatch');
export const weatherRaw=raw;
export const weatherWitness={...raw,bytes:Buffer.from(weatherModuleBytes).toString('base64')};
export function withWeatherWitness<T extends {program:{script:{module:string};bytes:string}}>(row:T): T & {program:{script:{module:string};bytes:string}} {
  if(row.program.script.module!==raw.script.module)throw new Error('Night witness hash mismatch');
  return {...row,program:{...row.program,bytes:weatherWitness.bytes}};
}

export const nightParameters=v.parse(v.object({parameters:v.record(v.string(),v.number())}),
  structuredClone(NALATI_NIGHT)).parameters;
