import type { Page } from 'playwright';
import type { RecordValue } from './value.mjs';

export interface CombatStep {
  step: string; weapon: string; target: string; near: { x: number; z: number };
  distance: number; hit: number; kill: number | null; settleFrames?: number;
}
export const STEPS: Record<string, CombatStep[]>;
export function combatSetup(step: CombatStep): {
  pose: { x: number; z: number; yaw: number; y?: number };
  aim: { x: number; y: number; z: number };
};
export function combat(page: Page, opts: { shard: string; tier: string; lane: string }): Promise<RecordValue>;
export function pauseResume(page: Page, tier: string): Promise<RecordValue>;
