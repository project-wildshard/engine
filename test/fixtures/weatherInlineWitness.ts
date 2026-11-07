// oxlint-disable-next-line import/no-nodejs-modules -- Frozen fixtures resolve from the native test repository, not Vite's HTTP module URL.
import { resolve } from 'node:path';
// Preserve the original inline unit oracle; production borrows the admitted
// raw module through its original scope, exercised by return-program-raw-modules.
// oxlint-disable-next-line import/no-nodejs-modules -- Frozen original bytes remain an independent native test oracle.
import {readFileSync} from 'node:fs';
import { NALATI_NIGHT } from './nalati-night';
import * as v from 'valibot';
import {WeatherReactionsSchema} from '@wildshard/format/weatherProgram';
import {DecisionScriptsSchema} from '@wildshard/format/decisionScripts';
import {sha256} from '../../src/shared/game/plugin/moduleHash';

const raw=v.parse(v.object({...WeatherReactionsSchema.entries,script:DecisionScriptsSchema.pipe[2].item}),
  JSON.parse(readFileSync(resolve('test/fixtures', 'nalati-weather-original.json'),'utf8')));
export const weatherModuleBytes=Uint8Array.from(readFileSync(resolve('test/fixtures', 'nalati-weather-original.wasm')));
if(raw.script.module!==`blobs/wasm/${sha256(weatherModuleBytes)}.wasm`)throw new Error('Weather witness hash mismatch');
export const weatherRaw=raw;
export const weatherWitness={...raw,bytes:Buffer.from(weatherModuleBytes).toString('base64')};
export function withWeatherWitness<T extends {program:{script:{module:string};bytes:string}}>(row:T): T & {program:{script:{module:string};bytes:string}} {
  if(row.program.script.module!==raw.script.module)throw new Error('Night witness hash mismatch');
  return {...row,program:{...row.program,bytes:weatherWitness.bytes}};
}

export const nightParameters=v.parse(v.object({parameters:v.record(v.string(),v.number())}),
  structuredClone(NALATI_NIGHT)).parameters;
