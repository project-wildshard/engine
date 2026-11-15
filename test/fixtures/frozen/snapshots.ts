import { readFileSync } from 'node:fs';
import { sha256 } from '../../../src/shared/game/plugin/moduleHash';
import { parse, object, record, string, number } from 'valibot';
import pins from './runtime-manifest.json' with { type: 'json' };
const manifest = parse(object({files: record(string(), object({bytes: number(), sha256: string()}))}), pins);
export function frozenRuntimeJson(name: string): unknown {
  const pin = manifest.files[name];
  if (pin === undefined || !/^[a-z0-9-]+\.json$/u.test(name)) throw new Error(`Unknown frozen runtime snapshot: ${name}`);
  const bytes = new Uint8Array(readFileSync(new URL(`./${name}`, import.meta.url)));
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Frozen runtime snapshot differs: ${name}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}
