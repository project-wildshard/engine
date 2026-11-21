/**
 * DF8 (meta DRIFTWOOD-FPS, mini-df8): three keys a custom shader's program by its shader stages' ids (`WebGLShaderCache`:
 * one id per distinct vertex or fragment source, freed when the last material using that source is disposed). The grid's
 * program keeper (render/programRetention.ts, G580 T2) pins a retiring cell's programs so a revisit links nothing, but the
 * cell's graph materials are disposed with it: their stages die, the revisit's rebuilt materials get new ids for the same
 * source, so every graph program links again beside its pinned twin (Driftwood's road crossing: 55 of 219 programs at the
 * route's end were byte-identical twins).
 *
 * This transform lets a custom program hold the two stages it was keyed by while it lives, when the renderer's
 * `wsHeldShaderStages` is true (device slot `debug.programReuse`, render/programReuse.ts). The same source
 * compiled again while its program lives then gets the same id, the same key and that program: the same GL source, so
 * nothing drawn changes. Off (the default), three runs as shipped: no program holds a stage. A three upgrade that changes
 * any anchor fails the build here.
 */
import type { Plugin } from 'vite';

/** Each anchor in three's build/three.module.js, and what it becomes; every anchor must occur exactly once. */
export const HELD_STAGE_EDITS: readonly (readonly [anchor: string, replacement: string])[] = [
  // the cache's own record of the stages each live program holds
  ['\t\tthis.materialCache = new Map();\n', '\t\tthis.materialCache = new Map();\n\t\tthis.programStages = new Map();\n'],
  ['\t\tthis.materialCache.clear();\n', '\t\tthis.materialCache.clear();\n\t\tthis.programStages.clear();\n'],
  ['\tgetVertexShaderStage( material ) {', `\tholdProgram( program, vertexId, fragmentId ) {

\t\tconst held = [];

\t\tfor ( const stage of this.shaderCache.values() ) {

\t\t\tif ( ( stage.id === vertexId || stage.id === fragmentId ) && held.includes( stage ) === false ) {

\t\t\t\tstage.usedTimes ++;
\t\t\t\theld.push( stage );

\t\t\t}

\t\t}

\t\tif ( held.length > 0 ) this.programStages.set( program, held );

\t}

\treleaseProgram( program ) {

\t\tconst held = this.programStages.get( program );

\t\tif ( held === undefined ) return;

\t\tthis.programStages.delete( program );

\t\tfor ( const stage of held ) {

\t\t\tstage.usedTimes --;

\t\t\tif ( stage.usedTimes === 0 && this.shaderCache.get( stage.code ) === stage ) this.shaderCache.delete( stage.code );

\t\t}

\t}

\tgetVertexShaderStage( material ) {`],
  // a new custom program holds its stages (slot on); a destroyed one lets them go (always: none held when the slot was off)
  ['program = new WebGLProgram( renderer, cacheKey, parameters, bindingStates );',
    'program = new WebGLProgram( renderer, cacheKey, parameters, bindingStates );\n\t\t\tif ( renderer.wsHeldShaderStages === true && parameters.customVertexShaderID !== undefined ) _customShaders.holdProgram( program, parameters.customVertexShaderID, parameters.customFragmentShaderID );'],
  ['\t\t\t// Free WebGL resources\n\t\t\tprogram.destroy();', '\t\t\t// Free WebGL resources\n\t\t\tprogram.destroy();\n\t\t\t_customShaders.releaseProgram( program );'],
];

/** Rewrite three's WebGL build once; refuse a three whose anchors moved. */
export function heldShaderStages(code: string, id: string): string | null {
  if (!/[\\/]three[\\/]build[\\/]three\.module\.js$/u.test(id)) return null;
  let out = code;
  for (const [anchor, replacement] of HELD_STAGE_EDITS) {
    const at = out.indexOf(anchor);
    if (at === -1 || out.includes(anchor, at + 1)) throw new Error(`three's shader cache changed (${id}); update vite/threeHeldShaderStages.ts`);
    out = out.slice(0, at) + replacement + out.slice(at + anchor.length);
  }
  return out;
}

/** The client build's plugin. */
export function heldShaderStagesPlugin(): Plugin {
  return { name: 'wildshard:three-held-shader-stages', enforce: 'pre', transform(code, id) { const out = heldShaderStages(code, id); return out === null ? null : { code: out, map: null }; } };
}
