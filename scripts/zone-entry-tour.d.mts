import type { Page } from 'playwright';

export interface Cell {
  instance: string;
  cell: readonly [number, number];
}
interface Pair {
  from: string;
  to: string;
}
export interface Tour {
  expected: number;
  arrivals: (Pair & {ms: number})[];
  failure?: Pair & {reason: string};
  pass: boolean;
}

export const FIRST_ZONE_PAIR: Readonly<Pair>;
export function zoneEntryTour(cells: readonly Cell[]): {from: Cell; to: Cell}[];
export function roadApproach(last: Cell, leg: {from: Cell; to: Cell}, center: {x: number; z: number}, pitch: number): {x: number; z: number; ride: boolean}[];
interface Point {x: number; z: number}
type PortalPoint = readonly [number, number, number];
export function portalExitPlan(entries: readonly {road: {at: PortalPoint}; route: readonly PortalPoint[]}[], center: Point, incoming: Point):
  {walk: Point[]; decks: (Point & {dx: number; dz: number})[]} | null;
export function walkZoneEntryTour(page: Page, origin: {x: number; z: number}, result: Tour, save: () => void): Promise<void>;
