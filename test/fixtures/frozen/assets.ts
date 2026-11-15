import { readFileSync } from 'node:fs';
import { sha256 } from '../../../src/shared/game/plugin/moduleHash';
import { parse, object, record, string, number } from 'valibot';
import pins from './assets/manifest.json' with { type: 'json' };
const manifest = parse(object({files: record(string(), object({bytes: number(), sha256: string()}))}), pins);
/** Fresh transport ownership on every read, including real-GC witnesses. */
export function frozenAsset(name: string): Uint8Array<ArrayBuffer> {
  const pin = manifest.files[name];
  if (pin === undefined || !/^[a-z0-9-]+\.(?:glb|ktx2)$/u.test(name)) throw new Error(`Unknown frozen asset: ${name}`);
  const bytes = new Uint8Array(readFileSync(new URL(`./assets/${name}`, import.meta.url)));
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Frozen asset differs: ${name}`);
  return bytes;
}
