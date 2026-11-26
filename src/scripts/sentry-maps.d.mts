/** SENTRY-TRIAGE S5: a page build's Sentry release and its private source-map upload. */
export const SENTRY_CLI: string;
export const SENTRY_ORG: string;
export const SENTRY_PROJECT: string;
export const ENVIRONMENTS: readonly string[];
export function mapRoots(dir: string): string[];
export function sentryMapPlan(input: {dir: string; version: string; build: string; environment: string; roots: readonly string[]}):
  {release: string; dist: string | undefined; commands: string[][]};
export function sentryToken(env?: Record<string, string | undefined>, file?: string): string;
