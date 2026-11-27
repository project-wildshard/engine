export type Channel = 'production' | 'staging';
export type HeadState = 'ok' | 'no-map' | 'map-404' | 'no-index' | 'uncooked';
export interface HeadRow {channel: Channel; build: string; slug: string; hash: string; from: string[]; state: HeadState; detail?: string}
export const ORIGINS: Readonly<Record<Channel, string>>;
export const PACKS: string;
export const API: string;
export const MISSING: readonly HeadState[];
export function mapKeys(loose: string, slug: string): string[];
export function auditCookedMaps(ports?: {fetch?: typeof fetch; channels?: readonly Channel[]; origins?: Readonly<Record<Channel, string>>; packs?: string; releases?: string; api?: string; now?: () => number}): Promise<HeadRow[]>;
export function auditLines(rows: readonly HeadRow[]): string[];
