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
export function walkZoneEntryTour(page: Page, origin: {x: number; z: number}, result: Tour, save: () => void): Promise<void>;
