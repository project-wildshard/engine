/** One CHANGELOG.md section: the version, its date and its 1 to 5 plain-language bullets. */
export interface Release { readonly version: string; readonly date: string; readonly notes: string[] }
export const CHANGELOG_PATH: string;
export const MAX_NOTES: number;
/** Why a bullet reads like a commit subject or a file, or null. */
export function noteProblem(note: string): string | null;
/** Every section in file order, and what is wrong with the file. */
export function parseChangelog(text: string): { releases: Release[]; problems: string[] };
/** What stops `version` shipping with this changelog. */
export function releaseProblems(text: string, version: string): string[];
/** The section a build of this tree shows (package.json's version). */
export function engineRelease(root: string): Release;
/** The problems at a commit for its package.json version, or for a tag's version. */
export function problemsAt(rev: string, tag?: string, cwd?: string): string[];
/** The pre-push hook's check over git's ref lines. */
export function pushProblems(lines: string, cwd?: string): string[];
