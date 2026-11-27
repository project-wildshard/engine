export const ZONELESS_PARTS: readonly string[];
export function roadServerParts(dir: string): Set<string>;
export function isZoneFile(path: string, shards: ReadonlySet<string>, road?: ReadonlySet<string>): boolean;
export function zoneFiles(dir: string, options?: { shards?: ReadonlySet<string> }): string[];
export function dropZoneFiles(dir: string, options?: { keep?: string }): string[];
export function checkZoneless(dir: string): void;
