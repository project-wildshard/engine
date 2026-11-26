import type { BudgetBaselines, BudgetCaps } from '../budgets/files.mjs';
import type { LedgerRow } from './ledgerVerdict.mjs';

export const CONTROL_ZONE: 'brasscap-mesa';
export interface MemoryLines { playingBytes: number; loadingBytes: number }
export interface ArmedMemory { lines: MemoryLines; zones: Set<string>; readings: Map<string, MemoryLines> }
export interface PhoneFootprint { playing: number; loading: number }
export function parseArmedMemory(value: unknown): ArmedMemory;
export function armedMemory(): ArmedMemory;
export function footprintBootFor(zone: string, armed: ReadonlySet<string>, placed: ReadonlySet<string>): 'online' | 'standalone';
export function ledgerZones(available: readonly string[], armed: ReadonlySet<string>, requested?: readonly string[]): string[];
export function guardZone(zone: string, armed: ReadonlySet<string>, run: () => Promise<void>, log: (line: string) => void): Promise<void>;
export function phoneFootprint(zone: string, runs: readonly unknown[], model: unknown, boot: 'standalone' | 'online'): PhoneFootprint;
export function footprintLines(caps: BudgetCaps): MemoryLines;
export function comparePhoneFootprint(reading: PhoneFootprint, lines: MemoryLines): string | null;
export function judgeFootprint(input: { zone: string; reads: readonly PhoneFootprint[]; contentKey: string;
  budgets: { caps: BudgetCaps; baselines: BudgetBaselines } }): LedgerRow[];
