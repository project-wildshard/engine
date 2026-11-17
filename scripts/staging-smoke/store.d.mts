// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-definitions, typescript/consistent-type-imports, typescript/explicit-module-boundary-types, typescript/no-explicit-any -- tsc's declaration output */
/** Every release in the store with a verdict, newest run first.
 * @param {string} store @returns {{ release: string, dir: string, at: string }[]} */
export function releases(store: string): {
    release: string;
    dir: string;
    at: string;
}[];
/** The newest stored release other than `release`, for the vision judge and time-to-play. @param {string} store @param {string} release */
export function lastRelease(store: string, release: string): {
    verdict: {
        scenarios?: {
            id: string;
            timeToPlay?: number;
            frames?: Record<string, string>;
        }[];
    };
    timeToPlay: Record<string, number>;
    release: string;
    dir: string;
    at: string;
} | undefined;
/** The stored keyframe `name` of scenario `id` in a release dir, if kept. @param {string} dir @param {string} id @param {string} name */
export function storedFrame(dir: string, id: string, name: string): string | undefined;
/**
 * Copy a run into the store: keyframes, clips and verdict.json (with paths pointing into the store), then prune to the last
 * KEEP_RELEASES releases. Returns the release's store dir.
 * @param {string} store @param {string} release @param {string} out @param {any} verdict
 */
export function keepRun(store: string, release: string, out: string, verdict: any): string;
/** The newest saved profile pair for `origin` from a release other than `release` (a re-run of a held release must start
 * from the release before it, not from its own profiles, already on the candidate).
 * @param {string} store @param {string} origin @param {string} [release] @returns {{ dir: string, note: ProfileNote } | undefined} */
export function newestProfiles(store: string, origin: string, release?: string): {
    dir: string;
    note: ProfileNote;
} | undefined;
/**
 * Save this run's K1 and K2 profiles as the next release's old cache. Two pairs stay: this release's and the newest other
 * release's (what a re-run of this release starts from); older pairs go.
 * @param {string} store @param {ProfileNote} note @param {Partial<Record<'chromium' | 'webkit', string>>} profiles
 */
export function saveProfiles(store: string, note: ProfileNote, profiles: Partial<Record<"chromium" | "webkit", string>>): string;
/** @typedef {import('./scenarios.mjs').StorageState} StorageState */
/** @typedef {{ release: string, build?: string, origin: string, clientVersion?: string, states: Partial<Record<'chromium' | 'webkit', StorageState>> }} ProfileNote */
export const STORE: string;
export const KEEP_RELEASES: 5;
export function releaseOf(dir: string): string;
export type StorageState = import("./scenarios.mjs").StorageState;
export type ProfileNote = {
    release: string;
    build?: string;
    origin: string;
    clientVersion?: string;
    states: Partial<Record<"chromium" | "webkit", StorageState>>;
};
