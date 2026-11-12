/** Carry the graphs of the builds the prune keeps, so a tab on one of them finds its files in the live deployment. */
export function carryPreviousDeploy(directory: string, options?: {
  readonly previousDirectory?: string;
  readonly previousOrigin?: string;
  /** builds live right now (default: the origin's or directory's version.json, read only on a clash) */
  readonly live?: readonly string[];
  /** whether a build is this repository's (default: its commit is in this checkout's history) */
  readonly ours?: (build: string) => boolean;
  /** a CI test build: a 5xx or network failure fetching the origin's manifest warns and carries nothing (a release refuses) */
  readonly optional?: boolean;
  /** PZ5: this build reads its content from a content base: its graph names code only, marked, so it is carried as code only */
  readonly contentBase?: boolean;
}): Promise<{current: number; builds: number; carried: number; bytes: number}>;
/** Whether an unreachable carried origin may mean no previous builds: a CI test build or the solo preview, never a
 * staging or production release (OFF-VERCEL OV6). */
export function previousDeployOptional(env: Readonly<Record<string, string | undefined>>): boolean;
/** OFF-VERCEL OV3: the origin a release carries from, by WS_CHANNEL (unset: production). Throws on another channel. */
export function channelOrigin(channel: string | undefined): string;
/** PZ5: what a carried build that reads its content from a content base carries, its code only. */
export const CHUNK: RegExp;
/** PZ5: every build each channel's live deploy-chunks.json names; refuses when a channel has no manifest. */
export function liveDeployBuilds(get?: typeof fetch, origins?: Readonly<Record<string, string>>): Promise<{channel: string; builds: string[]}[]>;
