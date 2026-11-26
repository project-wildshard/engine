export const GENERATED_FILES: readonly string[];
export const APPENDIX_START: string;
export const APPENDIX_END: string;
export interface GeneratedMeasurement { edges: Record<string, number>; ratchet: Record<string, unknown> }
export type GeneratedIncrease = { kind: 'graph'; key: string; before: number; after: number } | { kind: 'debt'; key: string; file: string; before: number; after: number };
export function debtCounts(ratchet: Record<string, unknown>): Record<string, Record<string, number>>;
export function replaceDebt(ratchet: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown>;
export function generatedIncreases(previous: GeneratedMeasurement, current: GeneratedMeasurement): GeneratedIncrease[];
export function increaseTrailers(increases: readonly GeneratedIncrease[], approver?: string): string;
export function verifyIncreaseTrailers(increases: readonly GeneratedIncrease[], message: string): void;
export function generatedPart(file: string, text: string): string;
export function builderGeneratedChanges(paths: readonly string[], before: (file: string) => string, staged: (file: string) => string): string[];
export function engineAppendix(surface: { indexes: Record<string, { name: string; from: string }[]> }): string;
