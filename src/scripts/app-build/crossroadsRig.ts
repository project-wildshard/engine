import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CROSSROADS_CONFIG } from '../../client/engine/core/crossroads';

/** The self-running phone rig and the installed Three version, staged by hand into a served build's `crossroads-rig/`.
 *  A developer tool: no page build ships it (QA 11-26 row 14, `noJunk.mjs` refuses one that does). Its BUILD is the
 *  served bundle's own BUILD_ID (version.json).
 *    node --import ./src/scripts/bake-loader.mjs src/scripts/app-build/crossroadsRig.ts <served dist dir> */
export function writeCrossroadsRig(outDir: string, root: string, apiOrigin: string): void {
  const { build } = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8')) as { build: string };
  const dir = join(outDir, 'crossroads-rig');
  mkdirSync(dir, { recursive: true });
  const write = (name: string, source: string): void => { writeFileSync(join(dir, name), source); };
  write('index.html', readFileSync(join(root, 'src/scripts/crossroads-rig/production.html'), 'utf8'));
  for (const name of ['core.js', 'phone.js']) write(name, readFileSync(join(root, 'src/scripts/crossroads-rig', name), 'utf8'));
  write('config.js', `export const BUILD = ${JSON.stringify(build)};\nexport const API_ORIGIN = ${JSON.stringify(apiOrigin)};\nexport const CFG = Object.freeze(${JSON.stringify(CROSSROADS_CONFIG)});\n`);
  for (const name of ['three.module.js', 'three.core.js']) write(name, readFileSync(join(root, 'node_modules/three/build', name), 'utf8'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = process.argv[2];
  if (outDir === undefined) throw new Error('crossroadsRig.ts <served dist dir>');
  const { apiOriginSet } = await import('../api-origin.mjs');
  writeCrossroadsRig(resolve(outDir), process.cwd(), apiOriginSet());
  console.log(join(resolve(outDir), 'crossroads-rig'));
}
