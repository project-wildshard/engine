export interface RigConfig {
  n0: number; n1: number; nf: number; libs: number; sims: number; churn: number; cpu: string;
  empty: number; secs: number; shadow: number; shadowRadius?: number; dpr: number;
  l0SplatSize?: number; l1AtlasSize?: number; farSegments?: number;
  capsMB: { l0: number; l1: number; far: number; lib: number; sim: number };
  trisCap: { l0: number; l1: number; far: number };
}
export interface RigRecord {
  phase: string; cfg: RigConfig; format: string; error: string | null; contextLost: boolean;
  accounted: Record<string, Record<string, number>>;
  frames: Record<string, Record<string, number> | null>;
  info: { memory: { geometries: number; textures: number }; jsHeapMB: number | null; drawingBuffer: number[] } | null;
  churn?: { swaps: number; liveMax: number; buildMsP50: number | null; buildMsMax: number | null };
}
/** Run the synthetic crossroads and return an explicit resource disposer after measurement. */
export function runRig(config: RigConfig): Promise<{ record: RigRecord; dispose: () => void }>;
