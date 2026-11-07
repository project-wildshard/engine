import type { Page } from 'playwright';
import type { ProbePose } from '../../src/client/engine/debug/probe';

export interface CaptureCamera { eye: readonly [number, number, number]; feet?: readonly [number, number, number]; yaw: number; pitch: number; probe?: ProbePose }
export function declaredProbePoses(cameras: Readonly<Record<string, CaptureCamera>>): ProbePose[];
export function poses(page: Page, opts: { shard: string; tier: string; out: string; fast?: boolean }): Promise<{ name: string; pos: number[]; calls: number; tris: number; fps: number; frameP95Ms: number; cpuP50Ms: number; cpuP95Ms: number; creatureBoxes: number; boxes: number[][]; shot: string; ssim: number }[]>;
