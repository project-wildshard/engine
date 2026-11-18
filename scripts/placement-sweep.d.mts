export const PLACEMENTS: string;
export const STAGING: string;
export interface SweepState { readonly serial: number; readonly cells: Readonly<Record<string, string>> }
export interface Outcome { readonly slug: string; readonly outcome: 'PASS' | 'FAIL' | 'NOCARD'; readonly detail: string }
export function changedPlacements(state: SweepState | null, file: { readonly serial: number; readonly cells: readonly { readonly slug: string; readonly hash: string }[] }): { serial: number; slugs: string[]; seed: boolean };
export function placementOutcomes(slugs: readonly string[], sweep: { readonly results: readonly { readonly slug: string; readonly pass: boolean; readonly enterMs: number | null; readonly thrown: string }[]; readonly missing?: readonly string[] } | null): Outcome[];
export function sweepLine(serial: number, build: string | undefined, outcome: Outcome): string;
export function sweepOptedIn(env: Readonly<Record<string, string | undefined>>, exists: (path: string) => boolean, home: string): boolean;
