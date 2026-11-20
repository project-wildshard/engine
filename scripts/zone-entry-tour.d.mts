import type { Page } from 'playwright';

export interface Cell {
  instance: string;
  slug?: string;
  cell: readonly [number, number];
}
interface Pair {
  from: string;
  to: string;
}
interface Leg { from: Cell; to: Cell }
interface SmokeArrival extends Pair { index: number; ms: number }
export interface Tour {
  expected: number;
  arrivals: (Pair & {ms: number})[];
  failure?: Pair & {reason: string};
  retries?: (Pair & {reason: string})[];
  resumedFrom?: number;
  pass: boolean;
}

export const FIRST_ZONE_PAIR: Readonly<Pair>;
export function featuredZoneEntry(cells: readonly Cell[], seed: number): Leg[];
export function smokeBatches(pending: readonly number[]): number[][];
export function retrySmokeEntries(route: readonly Leg[], proof: unknown, build: string, seed: number):
  {arrivals: SmokeArrival[]; pending: number[]};
export function smokeGap(proof: unknown): string | undefined;
export function stagedTourProof(value: unknown): unknown;
export function zoneEntryTour(cells: readonly Cell[]): {from: Cell; to: Cell}[];
export function resumeZoneEntry(route: readonly {from: Cell; to: Cell}[], proof: unknown, build: string, from: number): Tour['arrivals'];
export function retryZoneEntry<T>(run: (attempt: 1 | 2) => Promise<T | undefined>): Promise<T | undefined>;
export function zoneEntryCorridor(qualified: readonly {from: Cell; to: Cell}[], home: string, destination: string): {from: Cell; to: Cell}[];
export function roadApproach(last: Cell, leg: {from: Cell; to: Cell}, center: {x: number; z: number}, pitch: number): {x: number; z: number; ride: boolean}[];
interface Point {x: number; z: number}
type PortalPoint = readonly [number, number, number];
export function portalExitPlan(entries: readonly {road: {at: PortalPoint}; route: readonly PortalPoint[]}[], center: Point, incoming: Point):
  {walk: Point[]; decks: (Point & {dx: number; dz: number})[]} | null;
export function approachBudget(from: Point, points: readonly Point[]): number;
export function unstick(attempt: number): {key: 'Space' | 'KeyD' | 'KeyA'; ms: number};
export function spawnApproach(instance: string, at: Point, center: Point, dx: number, dz: number): (Point & {ride: boolean})[];
export function walkZoneEntryTour(page: Page, origin: Point, result: Tour, save: () => void,
  options: {restart:()=>Promise<Page>;resume?:{proof:unknown;build:string;from:number}}): Promise<void>;
