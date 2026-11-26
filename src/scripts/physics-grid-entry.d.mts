import type { Page } from 'playwright';

export interface EntryPhysicsInventory {
  registered: Record<string, number>;
  files?: Record<string, string>;
  native: Record<string, number>;
  total: number;
  pier: { y: number; owner: string | null } | null;
  grid: string | null;
}
export function enterPhysicsGrid(page: Page, base: string, tier: string, timeout: number): Promise<void>;
export function physicsEntryInventory(): EntryPhysicsInventory;
export function physicsEntryPierReady(inventory: EntryPhysicsInventory): boolean;
export function physicsEntryFailures(standalone: EntryPhysicsInventory, grid: EntryPhysicsInventory): string[];
export function waitForPhysicsBoot(page: Page, entry: 'grid' | 'standalone', timeout: number): Promise<void>;
