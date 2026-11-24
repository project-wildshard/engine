/** ZONE-SNAPSHOTS ZS1: scripts/zone-snapshot-guard.mjs, for test/zone-snapshot-guard.test.ts. */
export function compareVersions(a: string, b: string): number;
export function zoneNames(slugs: string[]): string[];
export function zoneSnapshotOffenders(input: { paths: string[]; read: (path: string) => string; current: string; zones: string[] }): string[];
export function judge(offenders: string[], baseline: string[]): { added: string[]; gone: string[] };
