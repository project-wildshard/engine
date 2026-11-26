export interface PairNumbers { ok: boolean; borderToControlMs?: number | null; freezeMs?: number | null; wallMs?: number | null; over50?: number | null }
export type Ratchet = Record<string, PairNumbers>;
export declare const MEASURES: { readonly borderToControlMs: { slack: number; factor: number }; readonly freezeMs: { slack: number; factor: number }; readonly wallMs: { slack: number; factor: number }; readonly over50: { slack: number; factor: number } };
export declare function pairKey(site: string, run: string, from: string, to: string): string;
export declare function worse(ratchet: Ratchet, now: Record<string, PairNumbers>): { key: string; measure: string; held: unknown; now: unknown }[];
export declare function tighten(ratchet: Ratchet, now: Record<string, PairNumbers>): Ratchet;
