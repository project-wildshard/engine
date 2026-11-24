// ZONE-SNAPSHOTS ZS9 (J507): Driftwood's live return program (sim/returns.json) with its guest inline, and two return
// guests the SDK compiled from made-up marsh sources on Driftwood's return contract (test/fixtures/sdk-built).
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { DecisionScriptsSchema } from '@wildshard/format/decisionScripts';
import { parse, object } from 'valibot';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import type { Scope } from '../../src/shared/engine/app/scope';
import { liveJson, livePath } from './livePin';
import { sdkBuiltJson } from './sdk-built/snapshots';
const schema = object({...ReturnProgramSchema.entries, script: DecisionScriptsSchema.pipe[2].item});
const driftwood = parse(object({program: schema}), liveJson('driftwood-isle', 'sim/returns.json')).program;
export const liveReturnInline = {...driftwood, bytes: Buffer.from(livePath('driftwood-isle', driftwood.script.module)).toString('base64')};
export const liveReturnProgram = {...liveReturnInline, bytes: ''};
export const madeUpMarsh = parse(schema, sdkBuiltJson('marsh-returns.json'));
export const madeUpSaltmarsh = parse(schema, sdkBuiltJson('saltmarsh-returns.json'));
const script = liveReturnProgram.script;
const assets = new Map([[script.module.slice('blobs/wasm/'.length, -'.wasm'.length), Uint8Array.from(Buffer.from(liveReturnInline.bytes, 'base64'))]]);
export function lendLiveReturns(owner: Scope): Scope {
  ReturnProgram.lendModules(owner, assets, [script]);
  return owner;
}
