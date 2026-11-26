export const ZONELESS_PARTS: readonly string[];
export function zoneFiles(dir: string, options?: { shards?: ReadonlySet<string> }): string[];
export function dropZoneFiles(dir: string): string[];
export function checkZoneless(dir: string): void;
export function isZoneFile(path: string, shards: ReadonlySet<string>): boolean;
