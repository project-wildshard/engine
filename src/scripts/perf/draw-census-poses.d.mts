import type { ProbePose } from '../types/wildshard-probe.d.ts';

export function censusEntry(primary: string): string;

export interface CensusCamera {
  readonly n: number; readonly name: string;
  readonly probe?: {x: number; y?: number; z: number; yaw: number; pitch: number};
  readonly feet?: readonly number[]; readonly yaw: number; readonly pitch: number;
}

export function censusSelection(slug?: string, pinePose?: string, mode?: string,
  cameras?: Readonly<Record<string, readonly CensusCamera[]>>, ninePose?: string): {
  slug: string; poseName: string; pose: ProbePose; modes: string[];
}[];
