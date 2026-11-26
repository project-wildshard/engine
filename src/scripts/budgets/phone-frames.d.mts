import type { Browser } from 'playwright';
import type { BudgetMeasures } from './cli.mjs';

export interface FrameReading {
  frame: number;
  triangles: number;
  draws: number;
  programs: number;
}

export interface ZoneFrames {
  slug: string;
  tier: string;
  low: boolean;
  deviceDpr: number;
  renderDpr: number;
  views: FrameReading[][];
}

export const PHONE_LOW: Readonly<{ width: number; height: number; deviceDpr: number; renderDpr: number }>;
export const FRAME_MS: number;
export function slowFrame(slug: string, name: string, ms: number): string | undefined;
export function expectPinnedZones(pins: Record<string, string>, built: readonly string[]): string[];
export function phoneFrameMeasures(pins: Record<string, string>, readings: readonly ZoneFrames[], commit?: string): BudgetMeasures;
export function readPhoneFrames(browser: Browser, base: string, slug: string): Promise<ZoneFrames>;
/** A pinned zone with no placement or cell gets a measuring cell in the page's inlined catalogue (meta MZ26). */
export function measuringCatalogue(html: string, slug: string): string;
