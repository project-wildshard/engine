// oxlint-disable-next-line import/no-nodejs-modules -- Committed fixture bytes.
import { readFileSync } from 'node:fs';

// CI21 (J232): engine reads no shard source (J65). These are Driftwood's shipped fixed-draw GLBs, copied byte for byte from
// the pinned driftwood-isle product (revision 3): models/fixed/gull.glb (sha256 178b7250…da0c) and models/fixed/reef-fish.glb
// (sha256 e6a03889…9a34). The fixed-draw law runs on real shipped templates without building Driftwood.
const FILES: Readonly<Record<string, string>> = { gull: 'gull.glb', 'reef-fish': 'reef-fish.glb' };

/** The shipped template bytes for one fixed-draw slot. */
export function fixedDrawModel(slot: string): Promise<Uint8Array> {
  const file = FILES[slot];
  if (file === undefined) return Promise.reject(new Error(`No fixed-draw fixture: ${slot}`));
  return Promise.resolve(new Uint8Array(readFileSync(new URL(`fixed-draws/${file}`, import.meta.url))));
}
