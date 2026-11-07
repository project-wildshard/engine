/** Carry the graphs of the builds the prune keeps, so a tab on one of them finds its files in the live deployment. */
export function carryPreviousDeploy(directory: string, options?: {
  readonly previousDirectory?: string;
  readonly previousOrigin?: string;
}): Promise<{current: number; builds: number; carried: number; bytes: number}>;
