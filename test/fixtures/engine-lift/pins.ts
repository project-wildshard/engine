// oxlint-disable-next-line import/no-nodejs-modules -- Select the published server slice in Ring 1.
import { existsSync } from 'node:fs';
import * as v from 'valibot';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { WeatherReactionsSchema } from '@wildshard/format/weatherProgram';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { loadHeadlessFolder } from '../../../src/server/host/headlessFolder';
import { ReturnProgram } from '../../../src/shared/game/population/returnProgram';
import type { Scope } from '../../../src/shared/engine/app/scope';
import type { SimHost } from '../../../src/server/engine/sim';
import { builtFolder } from './folder';

async function pin(slug: string) {
  const slice = `out/.slices/${slug}`;
  const product = await loadHeadlessFolder(process.env['WILDSHARD_RING'] === '1' && existsSync(`${slice}/shard.json`) ? slice : builtFolder(slug));
  const modules = v.parse(ReturnModulesSchema, product.section('actors/return-scripts'));
  const assets = new Map<string, Uint8Array>();
  await ReturnProgram.prepareModules(product, assets, modules);
  return { product, assets, lend: (scope: Scope): void => { ReturnProgram.lendModules(scope, assets, modules); } };
}
export const nalatiPin = await pin('nalati-grasslands');
export const pinePin = await pin('pine-hollow');
export const NALATI_RIDING = v.parse(v.object({ programs: v.object({ approach: ReturnProgramSchema, breaking: ReturnProgramSchema, riding: ReturnProgramSchema, initial: v.record(v.string(), v.number()), reins: v.unknown() }), taming: v.unknown() }), await nalatiPin.product.json('riding/session.json'));
export const NALATI_RIDING_PROGRAMS = NALATI_RIDING.programs;
export const admission = v.parse(v.object({ admission: ReturnProgramSchema }), await nalatiPin.product.json('actors/wildlife.json')).admission;
export function lendNalatiAdmission(scope: Scope): void { nalatiPin.lend(scope); }
export function lendNalatiPasture(scope: Scope): void { nalatiPin.lend(scope); }
export function lendNalatiRiding(scope: Scope): void { nalatiPin.lend(scope); }
export function admissionNative(host: SimHost): ReturnProgram { nalatiPin.lend(host.scope); return ReturnProgram.native(host, admission); }
export const weatherWitness = v.parse(v.object({ reactions: WeatherReactionsSchema }), await nalatiPin.product.json('world/weather.json')).reactions;
const titan = v.parse(v.object({ programs: v.object({ attack: ReturnProgramSchema, wind: ReturnProgramSchema }) }), await nalatiPin.product.json('combat/titan-fight.json'));
export const titanPrograms = { attack: inlineProgram(titan.programs.attack, nalatiPin.assets), wind: inlineProgram(titan.programs.wind, nalatiPin.assets), rules: inlineProgram(titan.programs.attack, nalatiPin.assets) };
export const NALATI_PASTURE = titanPrograms.wind;
function inlineProgram(input: unknown, assets: ReadonlyMap<string, Uint8Array>) {
  const row = v.parse(ReturnProgramSchema, input), script = v.parse(v.looseObject({ module: v.string() }), row.script), hash = script.module.slice('blobs/wasm/'.length, -'.wasm'.length);
  const witness = assets.get(hash); if (witness === undefined) throw new Error('Missing pinned return witness');
  return { ...row, bytes: Buffer.from(witness).toString('base64'), ...(row.v2 === undefined ? {} : { v2: { ...row.v2, bytes: Buffer.from(assets.get(row.v2.artifact.hash) ?? []).toString('base64') } }) };
}
export const pineLife = inlineProgram(v.parse(v.object({ program: v.unknown() }), await pinePin.product.json('actors/page-life.json')).program, pinePin.assets);
export const pineShelter = inlineProgram(v.parse(v.object({ program: v.unknown() }), await pinePin.product.json('actors/shelter.json')).program, pinePin.assets);
export const pineSpecies = pinePin.product.section('actors/species-programs');
import { parseEliteFeature } from '@wildshard/format/eliteFeature';
const eliteRows = parseEliteFeature(await pinePin.product.json('actors/elites.json'));
export const pineElites = { ...eliteRows, fights: eliteRows.fights.map(fight => ({ ...fight, program: parseSpawnScript(fight.program) })) };
export const pineNight = parseSpawnScript(v.parse(v.array(v.looseObject({ step: v.string() })), pinePin.product.section('actors/spawn-scripts')).find(row => row.step === 'pine.night'));
import { outputDescriptor } from '../../../src/shared/game/shardfile/outputDescriptor';
for (const file of outputDescriptor(pinePin.product.shardfile)?.index.files ?? []) {
  if (file.kind === 'wasm' && file.name !== undefined && !pinePin.assets.has(file.hash)) pinePin.assets.set(file.hash, await pinePin.product.file(file.name));
}
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing pinned module'); return value; }
export const pineNightBytes = required(pinePin.assets.get(pineNight.script.module.slice('blobs/wasm/'.length, -'.wasm'.length)));

import { parseSpawnScript } from '@wildshard/format/spawnScripts';
const chargeRow = nalatiPin.product.section('actors/spawn-scripts');
export const charge = parseSpawnScript(v.parse(v.array(v.unknown()), chargeRow).find(row => typeof row === 'object' && row !== null && 'step' in row && String(row.step).includes('charge')));
const chargeHash = charge.script.module.slice('blobs/wasm/'.length, -'.wasm'.length);
const chargeFile = outputDescriptor(nalatiPin.product.shardfile)?.index.files.find(file => file.hash === chargeHash);
if (chargeFile?.name === undefined) throw new Error('Missing pinned charge module');
export const chargeModule = await nalatiPin.product.file(chargeFile.name);
