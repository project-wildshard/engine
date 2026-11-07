import type { NativeFrame, AttributionFrame } from './draw-census-report.mjs';

export interface CensusProgramSource {
  id: number;
  shaders: {type: number; source: string}[];
  attributes: {name: string; type: number; size: number; location: number}[];
  uniforms: {name: string; type: number; size: number}[];
}
/** Native counters, with optional property counts confined to the attribution window. */
export function drawFrames(options: {frames: number; attribution: boolean; propertyCalls?: boolean; programSources?: boolean; systemIds?: string[]}): Promise<(NativeFrame & Partial<AttributionFrame> & {frame: number; frameMs: number; programSources?: CensusProgramSource[]; systems?: Record<string, {calls: number; ms: number}>})[]>;
