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
}): Promise<{current: number; builds: number; carried: number; bytes: number}>;
