import type { RecordValue } from './value.mjs';

export function sampleAudioBoundary(): RecordValue;
export function rememberAudioBoundary(report: object, boundary: string, observation: unknown): void;
export function publishAudioDiagnostics(path: string, reports: object[], failed: boolean): void;
