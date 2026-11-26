export interface RouteLeg { name: string; kind: 'stand' | 'walk' | 'fight'; seconds: number; points?: [number, number][]; sprint?: boolean;
  turn?: number; prey?: string; reach?: number; grid?: boolean; fixed?: boolean; face?: [number, number];
  dwell?: { point: number; seconds: number; face?: [number, number]; road?: boolean } }
export interface LegSample { seconds: number; frames: number; frameMs: number[]; updateMs: number[]; renderMs: number[]; gpuApproxMs: number[];
  draws: number; triangles: number; programs: number | null; delayMs: number | null; jitterMs: number | null; receiptSpacingErrorsMs?: number[];
  texUploads?: number; bufUploads?: number; readBacks?: number; textures?: number | null; geometries?: number | null; mem?: string | null;
  audioStarts?: number; audioLive?: number; busyMs?: number }
export interface LegSummary { seconds: number | null; fps: number | null; p50Ms: number | null; p95Ms: number | null; maxMs: number | null;
  over33: number; over50: number; over50Per30s: number | null; updateP50Ms: number | null; updateP95Ms: number | null;
  renderP50Ms: number | null; renderP95Ms: number | null; gpuApproxP95Ms: number | null; delayMs: number | null; delayMaxMs: number | null;
  jitterMs: number | null; jitterMaxMs: number | null; receiptSpacingP95Ms: number | null; receiptSpacingMaxMs: number | null;
  trianglesP95: number | null; drawsP95: number | null; programsMax: number;
  texUploads: number; bufUploads: number; readBacks: number; texturesMin: number; texturesMax: number; mem: string | null;
  audioLiveMax: number; audioLiveEnd: number | null; audioStartsPerS: number | null }
export interface LegResult { name: string; kind?: string; cap: number | null; error: string | null; nav: unknown; summary: LegSummary | null; samples?: LegSample[]; rec?: string | null; probe?: unknown; heap?: unknown }
export const ROUTES: Readonly<Record<string, readonly RouteLeg[]>>;
/** The start of a leg's error when the player died mid-leg (DF15). */
export const ROUTE_DIED: 'the player died during the route';
export function routeFor(slug: string): readonly RouteLeg[];
export function routeLegOnPage(leg: RouteLeg & { cap: 0 | 30 | 60 | null }): Promise<unknown>;
export function legSummary(samples: LegSample[]): LegSummary;
export function playRoute(driver: { evaluateAsync: (script: string, args: unknown[], timeoutMs: number) => Promise<unknown> },
  options: { slug: string; cap: 30 | 60 | null; rec?: string[]; legs?: number; log?: (line: string) => void; probe?: { start: string; stop: string };
    /** DF18: legs after which the driver's heapSnapshot sums the live heap */ heapAt?: string[];
    /** DF18: false leaves out the busy ping loop (its message events are garbage of their own) */ busy?: boolean }): Promise<LegResult[]>;
export function routeTable(legs: LegResult[]): string;
export function worstSegment(report: { legs: LegResult[] }[], cap: number): { name: string; p95Ms: number; over50Per30s: number; fps: number; runs: number }[];

export const holdWake: string;
export const askWake: string;
export const unlockAudio: string;
