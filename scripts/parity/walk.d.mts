import type { Page } from 'playwright';
import type { WalkResult, SoundLog } from '../../src/client/engine/debug/probe';

export const TOUCH: Readonly<{ move: string; look: string; dodge: string; use: string; pause: string; attack: string }>;
export function touch(page: Page, selector: string, opts?: { dx?: number; dy?: number; hold?: number; consume?: boolean }): Promise<void>;
export function touchLeg(page: Page): Promise<{ moved: number; yawDelta: number; dodged: boolean; used: boolean | 'n/a' | 'hidden' }>;
export function walkStep<T>(run: () => Promise<T>, milliseconds: number, phase: string): Promise<T>;
export function walk(page: Page, opts: { shard: string; tier: string; full: boolean; root: string; timeout: number }): Promise<{
  legs: WalkResult[]; stuck: number; sounds: SoundLog; touch?: Awaited<ReturnType<typeof touchLeg>>;
}>;
