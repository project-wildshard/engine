/**
 * The Basis Universal transcoder three's KTX2Loader runs in its workers (E157, src/client/engine/core/ktx2.ts): copied from
 * three/examples/jsm/libs/basis/ to public/basis/r<three revision>/ by every build (gitignored, like Rapier's WASM), so
 * it is served from our own origin and a three upgrade is a new folder — the service worker's cache-first `/basis/**`
 * and the HTTP cache never pair one version's .js with another's .wasm.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE = `${ROOT}node_modules/three/examples/jsm/libs/basis/`;
const FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'];

export function copyBasisTranscoder(): void {
  const { version } = JSON.parse(readFileSync(`${ROOT}node_modules/three/package.json`, 'utf8')) as { version: string };
  const rev = `r${version.split('.')[1] ?? '0'}`; // 0.186.0 → r186, three's REVISION
  const base = `${ROOT}public/basis/`;
  const dir = `${base}${rev}/`;
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) {
    const src = readFileSync(`${SOURCE}${f}`);
    if (!(existsSync(`${dir}${f}`) && readFileSync(`${dir}${f}`).equals(src))) copyFileSync(`${SOURCE}${f}`, `${dir}${f}`);
  }
  for (const d of readdirSync(base)) if (d !== rev) rmSync(`${base}${d}`, { recursive: true, force: true }); // an older three's copy
}
