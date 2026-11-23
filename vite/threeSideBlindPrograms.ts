/**
 * DF8 (meta DRIFTWOOD-FPS, mini-dwfps2, 2026-11-23): three keys every program by its material's side (`DOUBLE_SIDED`,
 * `FLIP_SIDED`) and its geometry's normals (`HAS_NORMAL`). Two kinds of program never read either:
 * - **shadow depth** (`MeshDepthMaterial`, `MeshDistanceMaterial`) with no displacement map: their shaders build no normal
 *   (`depth.glsl`, `distance.glsl` include `beginnormal_vertex` only under `USE_DISPLACEMENTMAP`) and read no side;
 * - **unlit** (`MeshBasicMaterial`) with no environment map: a normal is built only for `envmap_fragment` (and is dead code
 *   under skinning without one), and no chunk it includes reads a side define.
 * The shadow map's one shared depth material keys a new program whenever skinning or batching changes, taking the side
 * and normals of whichever object it draws then, so Driftwood's route held nine depth programs for four kinds of draw.
 *
 * This transform keys those programs with neither side nor normals when the renderer's `wsSideBlindPrograms` is true
 * (device slot `debug.programTwins`, render/programTwins.ts): the same pixels from fewer programs. Culling still follows
 * the material's side (the renderer's state reads it, not the program). Off, three runs as shipped. A three upgrade that
 * moves the anchor fails the build here.
 */
import type { Plugin } from 'vite';

/** The anchor in three's build/three.module.js (the end of `WebGLPrograms.getParameters`) and what it becomes. */
export const SIDE_BLIND_EDIT: readonly [anchor: string, replacement: string] = [
  '\t\t_activeChannels.clear();\n\n\t\treturn parameters;\n',
  `\t\t_activeChannels.clear();

\t\tif ( renderer.wsSideBlindPrograms === true && ( ( ( material.isMeshDepthMaterial === true || material.isMeshDistanceMaterial === true ) && parameters.displacementMap === false ) || ( material.isMeshBasicMaterial === true && parameters.envMap === false ) ) ) {

\t\t\tparameters.doubleSided = false;
\t\t\tparameters.flipSided = false;
\t\t\tparameters.vertexNormals = false;

\t\t}

\t\treturn parameters;
`,
];

/** Rewrite three's WebGL build once; refuse a three whose anchor moved. */
export function sideBlindPrograms(code: string, id: string): string | null {
  if (!/[\\/]three[\\/]build[\\/]three\.module\.js$/u.test(id)) return null;
  const [anchor, replacement] = SIDE_BLIND_EDIT;
  const at = code.indexOf(anchor);
  if (at === -1 || code.includes(anchor, at + 1)) throw new Error(`three's program parameters changed (${id}); update vite/threeSideBlindPrograms.ts`);
  return code.slice(0, at) + replacement + code.slice(at + anchor.length);
}

/** The client build's plugin. */
export function sideBlindProgramsPlugin(): Plugin {
  return { name: 'wildshard:three-side-blind-programs', enforce: 'pre', transform(code, id) { const out = sideBlindPrograms(code, id); return out === null ? null : { code: out, map: null }; } };
}
