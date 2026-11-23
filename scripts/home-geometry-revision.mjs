import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/** QA-FEEDBACK-2026-11-23 row 8 (Jake: "its only frozen and really fucking slow when doing a version upgrade or update"): the
 * built-Home cache (`src/client/game/shardfile/homeBuildCache.ts`) was keyed by the deploy's build id, so every update threw
 * the Home's built geometry away and the first boot after it decoded and assembled the whole Home again (headless WebKit,
 * Driftwood, phone Low: Home region 1.37 s on an update boot against 1.20 s warm). Its entries are a pure function of the
 * Home's admitted files (in each entry's key and the store's identity) and of the code that decodes and assembles them: the
 * files below and the exact specs of the libraries they decode with. A deploy that leaves these alone keeps the Home's
 * geometry; one that changes any of them starts the cache again.
 *
 * As with the renderer revision (J259, scripts/renderer-revision.mjs) the list is narrowed by hand: the whole import graph
 * moves on every release. A file that changes how Home geometry is decoded, assembled, snapshotted or restored joins this
 * list in the same commit (test/home-geometry-revision.test.ts holds it to the files that exist). */
export const HOME_GEOMETRY_INPUTS=Object.freeze([
  // the store and its snapshot codec
  'src/client/game/shardfile/homeBuildCache.ts',
  'src/client/game/shardfile/homeGeometrySnapshot.ts',
  // the whole Home (readWholeGeometry: the GLB decode, WholeGeometryAssembler) and the owned scene geometry
  'src/client/game/plugin/geometry.ts',
  'src/client/game/shardfile/worldSceneGeometry.ts',
  'src/client/engine/models/ownedGeometry.ts',
  'src/client/engine/models/nativeGeometry.ts',
  // the GLB parser both decode with, its lane inflate and the bounds the assembler writes
  'src/client/engine/anim/rig.ts',
  'src/client/engine/anim/rigParser.ts',
  'src/client/engine/core/deflate.ts',
  'src/client/engine/world/geometryBounds.ts',
  'src/shared/engine/core/ownedBuffer.ts',
  'src/shared/game/shardfile/wholeInputs.ts',
]);
/** The decoders' and geometry types' packages, by their exact specs in package.json. */
export const HOME_GEOMETRY_PACKAGES=Object.freeze(['three','meshoptimizer','fflate','@wildshard/format']);

/** The hash over any tree: `read` returns a root-relative file's bytes (a checkout's or an installed engine's `src`).
 * @param {(path:string)=>Buffer} read @returns {string} */
export function homeGeometryHash(read){
  const hash=createHash('sha256');
  for(const path of HOME_GEOMETRY_INPUTS)hash.update(path).update('\0').update(read(path)).update('\0');
  const pkg=JSON.parse(read('package.json').toString('utf8'));
  hash.update(JSON.stringify(HOME_GEOMETRY_PACKAGES.map(name=>[name,pkg.dependencies?.[name]??null])));
  return hash.digest('hex');
}

/** This engine's Home geometry revision, computed live (LS1, J250: no stamp file), as `rendererRevision` is. */
export function homeGeometryRevision(root=resolve(import.meta.dirname,'..')){
  return homeGeometryHash(path=>readFileSync(resolve(root,path)));
}
