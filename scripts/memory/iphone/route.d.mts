export interface RouteLeg { name: string; kind: 'stand' | 'walk' | 'fight'; seconds: number; points?: [number, number][]; sprint?: boolean;
  turn?: number; prey?: string; reach?: number }
export interface LegSample { seconds: number; frames: number; frameMs: number[]; updateMs: number[]; renderMs: number[]; gpuApproxMs: number[];
  draws: number; triangles: number; programs: number | null; delayMs: number | null; jitterMs: number | null }
export interface LegSummary { seconds: number | null; fps: number | null; p50Ms: number | null; p95Ms: number | null; maxMs: number | null;
  over33: number; over50: number; over50Per30s: number | null; updateP50Ms: number | null; updateP95Ms: number | null;
  renderP50Ms: number | null; renderP95Ms: number | null; gpuApproxP95Ms: number | null; delayMs: number | null; delayMaxMs: number | null;
  jitterMs: number | null; jitterMaxMs: number | null; trianglesP95: number | null; drawsP95: number | null; programsMax: number }
export interface LegResult { name: string; kind?: string; cap: number | null; error: string | null; nav: unknown; summary: LegSummary | null; samples?: LegSample[] }
export const ROUTES: Readonly<Record<string, readonly RouteLeg[]>>;
export function routeFor(slug: string): readonly RouteLeg[];
export function routeLegOnPage(leg: RouteLeg & { cap: 30 | 60 | null }): Promise<unknown>;
export function legSummary(samples: LegSample[]): LegSummary;
export function playRoute(driver: { evaluateAsync: (script: string, args: unknown[], timeoutMs: number) => Promise<unknown> },
  options: { slug: string; cap: 30 | 60 | null; log?: (line: string) => void }): Promise<LegResult[]>;
export function routeTable(legs: LegResult[]): string;
export function worstSegment(report: { legs: LegResult[] }[], cap: number): { name: string; p95Ms: number; over50Per30s: number; fps: number; runs: number }[];
