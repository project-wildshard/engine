export interface NativeFrame { calls: number; renderMs: number; workMs: number; triangles: number }
export interface NativeSummary {
  frames: number; drawsP50: number; drawsMax: number; workMsP50: number; renderMsP50: number;
  renderUsPerDrawP50: number | null; zeroDrawFrames: number; trianglesP50: number;
}
export function nativeSummary(frames: NativeFrame[]): NativeSummary;
export interface Draw {
  owner: string; pass: string; count: number; program: number | null;
  materialId?: string; geometryId?: string; nodeMaterial?: boolean; instances?: number; skinned?: boolean;
}
export interface AttributionFrame { draws: Draw[]; useProgram: number; uniforms: number; propertyReads?: {total: number; byKind: Record<string, number>} | null }
export interface AttributionSummary {
  propertyReads: {totalPerFrame: number; byKind: Record<string, number>} | null;
  frames: number; draws: number; passes: Record<string, number>;
  byOwner: {owner: string; drawsPerFrame: number}[];
  programs: number; programsPerFrame: number; treeDraws: Record<string, number>; materials: number; geometries: number; nodeDraws: number; singleCopyMain: number;
  useProgram: number; uniforms: number;
}
export function attributionSummary(frames: AttributionFrame[]): AttributionSummary;
export interface SampleProfile<T> {nodes: {id: number; callFrame: T; children?: number[]}[]; samples?: number[]; timeDeltas: number[]}
export function sampledCpu<T>(profile: SampleProfile<T>, locate: (frame: T) => {source: string; name: string; line?: number | null; column?: number | null}, frames: number): {
  functions: {source: string; name: string; line: number | null; column: number | null; selfMs: number; inclusiveMs: number; selfMsPerFrame: number | null; inclusiveMsPerFrame: number | null}[];
  frames: number; mappedSources: number; msPerFrame: Record<string, number | null>; qualifier: string;
};
