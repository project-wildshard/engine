export type Phase = 'boot' | 'load' | 'play' | 'title' | 'doctor';
export type Outcome = 'pass' | 'ui-fail' | 'blocked-dependency' | 'unsupported' | 'harness-fail';
export interface Case { mode: string; id: string; owner: string; phase: Phase; screen: string; inject: string; recover: string; deadlineMs: number; run?: string; blocked?: string; chromiumOnly?: boolean; parent?: string }
export const CASES: readonly Case[];
export function selectCases(asked: string): Case[];
export function verdict(rows: readonly { outcome: Outcome }[]): 0 | 1 | 2;
export function names(attribute: string | null, id: string): boolean;
export function rawLeak(text: string): string | null;
