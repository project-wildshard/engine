// oxlint-disable-next-line import/no-nodejs-modules -- A proof runs the bake and reads its files.
import { execFile } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- A proof runs the bake and reads its files.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A proof runs the bake and reads its files.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- A proof runs the bake and reads its files.
import { promisify } from 'node:util';
import { readGridCollision, type GridCollisionStrip } from '../../src/shared/game/grid/gridCollision';

const read = (root: string): readonly GridCollisionStrip[] => readGridCollision(
  JSON.parse(readFileSync(resolve(root, 'out/.app/grid-collision/strips.json'), 'utf8')), readFileSync(resolve(root, 'out/.app/grid-collision/shapes.bin')));

/** CI packs its test products before the app build, so a test job holds no bake: the bake runs here, on those products. */
async function bake(): Promise<readonly GridCollisionStrip[]> {
  if (existsSync('out/.app/grid-collision/strips.json')) return read('.');
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'grid-collision-'));
  try {
    await promisify(execFile)(process.execPath, ['--experimental-transform-types', '--import', './scripts/bake-loader.mjs', 'scripts/bake-grid-seams.mjs', root], { maxBuffer: 64 * 1024 * 1024 });
    return read(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

let baked: Promise<readonly GridCollisionStrip[]> | undefined;
/** The road's collision as the bake left it, for a proof whose worker is not the deployed one. */
export function bakedGridCollision(): Promise<readonly GridCollisionStrip[]> { return baked ??= bake(); }
