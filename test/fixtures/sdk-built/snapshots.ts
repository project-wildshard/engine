// ZONE-SNAPSHOTS ZS9 (J507): SDK outputs of made-up inputs, each checked against its pinned size and sha256.
import { readFileSync } from 'node:fs';
import { sha256 } from '../../../src/shared/game/plugin/moduleHash';
import { parse, object, record, string, number } from 'valibot';
import pins from './runtime-manifest.json' with { type: 'json' };
const manifest = parse(object({files: record(string(), object({bytes: number(), sha256: string()}))}), pins);
const fixtureModuleUrl = import.meta.url;
const fixtureRoot = new URL('./', fixtureModuleUrl);
export function sdkBuiltBytes(name: string): Uint8Array {
  const pin = manifest.files[name];
  if (pin === undefined || !/^[a-z0-9-]+\.json$/u.test(name)) throw new Error(`Unknown SDK-built snapshot: ${name}`);
  const bytes = new Uint8Array(readFileSync(new URL(name, fixtureRoot)));
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`SDK-built snapshot differs: ${name}`);
  return bytes;
}

export function sdkBuiltJson(name: string): unknown {
  return JSON.parse(new TextDecoder().decode(sdkBuiltBytes(name)));
}
