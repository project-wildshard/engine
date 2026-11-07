import type {ESTree} from 'vite';

export type Side = 'shared' | 'server' | 'client' | 'cook';
export interface SideEntry { readonly side: Side; readonly mixed: boolean }
export type SideEdges = Record<string, Record<string, number>>;
export interface SideViolation { readonly edge: string; readonly unit: string; readonly node: unknown; readonly detail: string }
export interface SideCensus {
  readonly files: string[];
  readonly untagged: string[];
  readonly stale: string[];
  readonly counts: SideEdges;
  readonly units: {readonly from: string; readonly edge: string; readonly unit: string}[];
}
export const SIDES_FILE: string;
export const SIDE_EDGES_FILE: string;
export const SIDE_EDGES_LIST: string;
export const SIDES: readonly Side[];
export function inScope(path: string): boolean;
export function sidePath(filename: string): string;
export function readSides(raw: unknown): Map<string, SideEntry>;
export function readEdges(raw: unknown): SideEdges;
export function edgeName(edge: string): boolean;
export function importCandidates(path: string, specifier: string): string[];
export function sideFacts(program: ESTree.Program): {imports: {node: object; source: string}[]; render: {node: object; token: string}[]; dom: {node: object; token: string}[]};
export function sideViolations(path: string, program: ESTree.Program, sides: ReadonlyMap<string, SideEntry>): SideViolation[];
export function sideSources(root: string): string[];
export function sideCensus(root: string, sides: ReadonlyMap<string, SideEntry>): SideCensus;
export function edgeTotals(files: SideEdges): Record<string, number>;
export function compareSideEdges(before: unknown, after: unknown): string[];
export function engineSidesRule(sidesFile: string, edgesFile: string): {meta: object; create: (context: object) => object};
