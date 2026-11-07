import type { Component } from './shard-components.mjs';
/** G520 reviewed ownership; these rows are the fixture-backed cut list. */
export function platformChargeback(path: string, name?: string): Component | null;
export function hasChargebackDeclarations(path: string): boolean;
export function retiredPlatformModule(path: string): boolean;
export function inlinePlatformSpans(path: string, source: string, report?: (line: string) => void): { name: string; lines: number[] }[];
export function inlinePlatformPaths(): string[];
export function chargePlatformUsers(moduleUsers: Map<string, Set<string>>, bindingUsers: Map<string, Set<string>>): void;
export function recordPrivateCharge<T extends { path: string; lines: number; name?: string }>(charges: Map<string, T[]>, owner: string | undefined, row: T, report?: (line: string) => void): boolean;
