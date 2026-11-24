// ZONE-SNAPSHOTS ZS9 (J507): GLB and KTX2 bakes of made-up recipes (recipes in assets/manifest.json), each checked
// against its pinned size and sha256. No zone bytes live here.
import { readFileSync } from 'node:fs';
import { sha256 } from '../../../src/shared/game/plugin/moduleHash';
import { parse, object, record, string, number } from 'valibot';
import pins from './assets/manifest.json' with { type: 'json' };
const nativeModuleUrl=import.meta.url;
const assetRoot=new URL('./assets/',nativeModuleUrl);
const manifest = parse(object({files: record(string(), object({bytes: number(), sha256: string()}))}), pins);
/** Fresh transport ownership on every read, including real-GC witnesses. */
export function sdkBuiltAsset(name: string): Uint8Array<ArrayBuffer> {
  const pin = manifest.files[name];
  if (pin === undefined || !/^[a-z0-9-]+\.(?:glb|ktx2)$/u.test(name)) throw new Error(`Unknown SDK-built asset: ${name}`);
  const bytes = new Uint8Array(readFileSync(new URL(name,assetRoot)));
  if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`SDK-built asset differs: ${name}`);
  return bytes;
}
