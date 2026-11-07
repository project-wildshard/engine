import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CROSSROADS_CONFIG } from '../../src/client/engine/core/crossroads';

/** The self-running phone rig and the installed Three version, written into every production web build's
 *  `crossroads-rig/` (scripts/build-app.mjs runs it before the service worker, which counts these files; was
 *  vite/crossroadsRig.ts). Its BUILD is the bundle's own BUILD_ID (version.json). */
export function writeCrossroadsRig(outDir: string, root: string, apiOrigin: string): void {
  const { build } = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8')) as { build: string };
  const dir = join(outDir, 'crossroads-rig');
  mkdirSync(dir, { recursive: true });
  const write = (name: string, source: string): void => { writeFileSync(join(dir, name), source); };
  write('index.html', readFileSync(join(root, 'scripts/crossroads-rig/production.html'), 'utf8'));
  for (const name of ['core.js', 'phone.js']) write(name, readFileSync(join(root, 'scripts/crossroads-rig', name), 'utf8'));
  write('config.js', `export const BUILD = ${JSON.stringify(build)};\nexport const API_ORIGIN = ${JSON.stringify(apiOrigin)};\nexport const CFG = Object.freeze(${JSON.stringify(CROSSROADS_CONFIG)});\n`);
  for (const name of ['three.module.js', 'three.core.js']) write(name, readFileSync(join(root, 'node_modules/three/build', name), 'utf8'));
}
