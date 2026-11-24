import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from '../../../src/shared/game/plugin/moduleHash';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { parse, object, string, unknown, optional, array } from 'valibot';

const entrySchema = object({file: optional(string()), sha256: optional(string()), text: optional(string()),
  rows: optional(unknown()), blobs: optional(array(object({bytes: string()})))});
function entry(method: string, args: readonly unknown[]) {
  const wire = JSON.stringify([method, args], (_key, value: unknown) => value instanceof Map ? {map: [...value]} : value);
  const key = sha256(new TextEncoder().encode(wire));
  return parse(entrySchema, JSON.parse(readFileSync(resolve('test/fixtures/sdk-built/script-guests', `${key}.json`), 'utf8')));
}
function bytes(method: string, args: readonly unknown[]): Uint8Array<ArrayBuffer> {
  const pin = entry(method, args);
  if (pin.file === undefined || !/^[a-f0-9]{64}\.wasm$/u.test(pin.file) || pin.sha256 === undefined) throw new Error('Missing frozen script guest');
  const value = new Uint8Array(readFileSync(resolve('test/fixtures/sdk-built/script-guests', pin.file)));
  if (sha256(value) !== pin.sha256) throw new Error('Frozen script guest differs');
  return value;
}
/** These are source-keyed snapshot readers; no compiler or SDK is loaded by a test. */
export async function frozenLegacyGuest(source: string, options: Readonly<Record<string, unknown>>): Promise<Uint8Array<ArrayBuffer>> {
  return bytes('compileScript', [source, options]);
}
export async function frozenV2Guest(source: string, options: Readonly<Record<string, unknown>>): Promise<Uint8Array<ArrayBuffer>> {
  return bytes('compileScriptV2', [source, options]);
}
export async function frozenSimGuest(source: string, options: Readonly<Record<string, unknown>>): Promise<Uint8Array<ArrayBuffer>> {
  return bytes('compileSimV2', [source, options]);
}
export async function frozenDecisionGuest(...args: readonly unknown[]) {
  const pin = entry('compileDecisionScripts', args);
  if (pin.blobs === undefined) throw new Error('Missing frozen decision guest');
  const rows = parseDecisionScripts(pin.rows), blobs = pin.blobs.map(blob => ({bytes: Uint8Array.from(Buffer.from(blob.bytes, 'base64'))}));
  const hashes = new Set(blobs.map(blob => `blobs/wasm/${sha256(blob.bytes)}.wasm`));
  if (rows.some(row => !hashes.has(row.module))) throw new Error('Frozen decision guest module differs');
  return {rows, blobs};
}
function text(method: string, args: readonly number[]): string {
  const value = entry(method, args).text;
  if (value === undefined) throw new Error('Missing frozen SDK source');
  return value;
}
export const frozenV2CoreSource = (io: number): string => text('v2CoreSource', [io]);
export const frozenGroupBankSource = (io: number, width: number): string => text('groupBankSourceV2', [io, width]);
