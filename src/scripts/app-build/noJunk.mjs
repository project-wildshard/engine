/** QA 11-26 row 14 (Jake, 11-26: "Let's remove the junk lol."): a page build ships no video and no measuring rig. The
 * two trailers (`public/trailer-15.mp4`, `trailer-30.mp4`, 10 MB) were named by no page, and the Crossroads rig
 * (`crossroads-rig/`, 2 MB of three.js beside the bundle) is a developer tool, staged by hand onto a served build
 * (`src/scripts/crossroads-rig/stage.sh`, `src/scripts/app-build/crossroadsRig.ts`). The build refuses either one. */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The top-level folder a page build never holds. */
export const RIG = 'crossroads-rig';
const VIDEO = /\.mp4$/iu;

/** Every `.mp4` under `outDir` and its `crossroads-rig/` folder, as `/`-separated paths, sorted.
 * @param {string} outDir @returns {string[]} */
export function junkIn(outDir) {
  if (!existsSync(outDir)) return [];
  const found = existsSync(join(outDir, RIG)) ? [`${RIG}/`] : [];
  for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && VIDEO.test(entry.name)) found.push(relative(outDir, join(entry.parentPath, entry.name)).split(sep).join('/'));
  }
  return found.sort();
}

/** Throws when a page build holds a video or the measuring rig. @param {string} outDir */
export function checkNoJunk(outDir) {
  const found = junkIn(outDir);
  if (found.length > 0) {
    throw new Error(`The page build holds junk (QA 11-26 row 14): ${found.join(', ')}. No page reads a video or the `
      + 'measuring rig; keep videos out of public/ and stage the rig by hand (src/scripts/crossroads-rig/stage.sh).');
  }
}
