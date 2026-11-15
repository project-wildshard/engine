import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { DecisionScriptsSchema } from '@wildshard/format/decisionScripts';
import { parse, object } from 'valibot';
import { ReturnProgram } from '../../../src/shared/game/population/returnProgram';
import type { Scope } from '../../../src/shared/engine/app/scope';
import { frozenRuntimeJson } from './snapshots';
const returns = frozenRuntimeJson('returns.json'), marsh = frozenRuntimeJson('marsh-returns.json'), saltmarsh = frozenRuntimeJson('saltmarsh-returns.json');
const schema = object({...ReturnProgramSchema.entries, script: DecisionScriptsSchema.pipe[2].item});
export const frozenReturnInline = parse(schema, returns);
export const frozenReturnProgram = {...frozenReturnInline, bytes: ''};
export const frozenMarsh = parse(schema, marsh);
export const frozenSaltmarsh = parse(schema, saltmarsh);
const script = frozenReturnProgram.script;
const assets = new Map([[script.module.slice('blobs/wasm/'.length, -'.wasm'.length), Uint8Array.from(Buffer.from(frozenReturnInline.bytes, 'base64'))]]);
export function lendFrozenReturns(owner: Scope): Scope {
  ReturnProgram.lendModules(owner, assets, [script]);
  return owner;
}
