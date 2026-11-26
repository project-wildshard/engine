/** SENTRY-ZERO SZ7: every Sentry send goes through a funnel that holds the send policy. */
export const FUNNELS: readonly string[];
export function funnelViolations(files: readonly { path: string; text: string }[]): string[];
export function sourceFiles(cwd?: string): { path: string; text: string }[];
