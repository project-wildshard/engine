export function layerOf(path: string): string | null;
export function headModuleExists(path: string, tracked: ReadonlySet<string>, diskExists: (path: string) => boolean): boolean;
export function resolveSpecifier(from: string, spec: string, exists: (path: string) => boolean): string | null;
export function importsOf(path: string, source: string, exists: (path: string) => boolean): { to: string; dynamic: boolean }[];
export function reachViolation(from: string, to: string, dynamic: boolean): string | null;
export function graph(files: string[], read: (path: string) => string, exists: (path: string) => boolean): { edges: Record<string, number>; violations: string[] };
export function compareEdges(recorded: Record<string, number>, current: Record<string, number>): { failures: string[]; fell: string[] };
export const APPROVED_DOWNWARD: RegExp;
export function allowedGraphDirection(key: string): boolean;
