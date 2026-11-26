// Generated from the JSDoc in the .mjs beside it (meta STAGING-QA SQ14): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-definitions -- tsc's declaration output */
export type Device = { udid: string; name: string; state: string; version: number[]; runtime: string; type: string };
export const QA_DEVICE: 'Wildshard QA';
export function pickPhone(listing: unknown): Device | undefined;
export function qaDevice(listing: unknown): { udid: string; state: string } | undefined;
export function missingTools(): string | undefined;
export function iosSafari(options: { root: string; url: string; out: string; build: string; maxMs?: number }): Promise<{
  id: 'ios-safari'; browser: 'ios-safari'; pass: boolean; seconds: number; playedMs: number; log: string; reason?: string;
}>;
