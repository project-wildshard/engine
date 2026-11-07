export interface TextureTierJob {
  kind: 'resize' | 'phone'; source: string; served: string; output: string; max: number;
}
export function textureTierJobs(files: readonly string[]): TextureTierJob[];
