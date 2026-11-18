// Generated from the JSDoc in the .mjs beside it (meta STAGING-QA SQ16): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
import type { Finding } from './staging-smoke/checks.mjs';

export type LegKind = 'local' | 'candidate' | 'staging';
export const LEG_TARGET_S: 600;
export const LEG_CAP_S: 720;
export const STEPS: Readonly<Record<string, { seconds: number; catches: string }>>;
export const LEGS: Readonly<{ readonly local: readonly string[]; readonly candidate: readonly string[]; readonly staging: readonly string[] }>;
export function nominalSeconds(steps: readonly string[]): number;
export function budgetLines(kind: LegKind, steps: readonly string[]): string[];
export function budgetFinding(kind: LegKind, seconds: number): Finding | undefined;
