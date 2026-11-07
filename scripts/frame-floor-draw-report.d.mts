import type { DrawBudgetAssessment, DrawSample } from '../src/client/engine/core/drawBudget';
import type { FloorCpuPhaseReading } from './frame-floor-report-phase.mjs';

export interface FloorDrawRecord {
  sha?: string; runId?: string; when?: string; complete?: boolean;
  cpuPhaseMode?: 'after-ready'; bootCpuRate?: number;
  softwareCensus?: {viewport:{width:201;height:437};frames:4;scope:'spawn-only'};
  drawBudgetMode?: 'enforce' | 'report-only'; chromiumCpuRate?: number; chromiumAngle?: string; chromiumAngleExplicit?: boolean;
  shards?: readonly string[]; surface?: string; settings?: { tier?: string };
  results: readonly { surface: string; rows: readonly {
    shard: string; complete?: boolean; cpuPhase?: FloorCpuPhaseReading | null; metadata?: { renderer?: string; viewport?: number[]; canvas?: number[]; renderScale?: number; settings?: { tier?: string } };
    rows?: readonly { pose?: { name?: string }; frames: number; sampleRange?: {startMs:number;endMs:number}; drawSamples?: readonly (DrawSample & {drawnFrame?:number})[] }[];
  }[] }[];
}
export type DrawReportStatus = 'PASS' | 'MISS' | 'INCOMPLETE' | 'NOT MEASURED';
export interface FloorDrawPose {
  surface: string; shard: string; pose: string; tier: string; cpuRate: number;
  frames: number; status: DrawReportStatus; budget: DrawBudgetAssessment;
}
export interface FloorDrawShard {
  renderer: string | null;
  viewport: number[] | null; canvas: number[] | null;
  surface: string; shard: string; bootCpuRate: number; measuredCpuRate: number | null; poses: number; samples: number; frames: number;
  validDrawSamples: number; validCpuSamples: number; status: DrawReportStatus;
  maxDraws: number | null; maxRenderCpuUsPerDraw: number | null; meanRenderCpuUsPerDraw: number | null;
}
export interface FloorDrawReport {
  officialTimingCredit: false;
  softwareDiagnostic: boolean;
  schema: 1; sha: string | null; runId: string | null; when: string | null;
  blocking: boolean; complete: boolean; drawLimit: number; cpuLimitUs: number; chromiumAngle: string | null;
  measurement: string; shards: FloorDrawShard[]; poses: FloorDrawPose[];
}
export function frameFloorDrawReport(record: FloorDrawRecord): FloorDrawReport;
export function frameFloorDrawMarkdown(report: FloorDrawReport): string;
/** Print only actually collected paired samples, retaining missing values as n/a. */
export function frameFloorDrawConsole(shard: string, pose: string, frames: number, budget: DrawBudgetAssessment, renderer: string): string;
export function writeFrameFloorDrawReport(record: FloorDrawRecord, output: string, summary?: string): { json: string; markdown: string };
