/** Program discovery used by the shipping shader precompile batches. */
import type { Renderer } from '../render/renderer';

/** three's WebGLProgram, the parts the boot reads (r.info.programs is typed as `unknown` entries) */
export interface ProgramLike { type: string; name: string; cacheKey: string; usedTimes: number; id: number; isReady: () => boolean; program: WebGLProgram; getUniforms: () => unknown }
type Programs = readonly ProgramLike[];

const programsOf = (r: Renderer): Programs => (r.info.programs ?? []) as unknown as Programs;

/** The programs that exist now, as a set (diff against later to see what a render compiled). */
export function snapshotPrograms(r: Renderer): Set<ProgramLike> { return new Set(programsOf(r)); }

export function newProgramsSince(r: Renderer, before: Set<ProgramLike>): ProgramLike[] {
  return programsOf(r).filter((p) => !before.has(p));
}
