// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-definitions, typescript/consistent-type-imports -- tsc's declaration output */
/** Runs in the page before any of its scripts: a 60 fps requestAnimationFrame cap (the GPU is Jake's, lane rules), and
 * console lines for long tasks, WebSocket closes and the RECONNECTING strip, which the runner collects from every document. */
export function smokeProbes(): void;
/** Runs in the page: what the J383 old-cache checks read. */
export function storageState(): Promise<StorageState>;
/** Sample from `tap` until play has held for `holdMs` (or the budget runs out), saving keyframes on the way.
 * @param {Page} page @param {{ name: string, tap: () => Promise<void>, budgetMs?: number, holdMs?: number, shoot?: (name: string) => Promise<void>,
 *   allowTitleFirst?: boolean }} options @returns {Promise<Leg>} */
export function watchLeg(page: Page, { name, tap, budgetMs, holdMs, shoot, allowTitleFirst }: {
    name: string;
    tap: () => Promise<void>;
    budgetMs?: number;
    holdMs?: number;
    shoot?: (name: string) => Promise<void>;
    allowTitleFirst?: boolean;
}): Promise<Leg>;
/** The samples from the first one that is not the title on, keeping the first sample's document as the tap's.
 * @param {readonly Sample[]} samples @returns {Sample[]} */
export function dropLeadingTitle(samples: readonly Sample[]): Sample[];
/** Tap the title's Shard Select, skip the name prompt, pick `card`, and return the Enter World tap (journey-proof's tapJourney,
 * split so watchLeg can sample from the tap). `onDrop` hears every drop note dismissed on the way (SB30).
 * @param {Page} page @param {string} card @param {() => void} [onDrop] @returns {Promise<() => Promise<void>>} */
export function toShardSelect(page: Page, card: string, onDrop?: () => void): Promise<() => Promise<void>>;
/** A drop note from the page before is the title's own modal (journey-proof): dismiss it, and say whether one was there.
 * @param {Page} page @returns {Promise<boolean>} */
export function clearDrop(page: Page): Promise<boolean>;
/** An old profile can recover its previous world (SR4) instead of opening the title. Acknowledge its notice and use the
 * player's pause/exit controls; keep the drop in the result and leave all old-cache checks intact.
 * @param {Page} page @param {{onDrop?: () => void, onRecovery?: () => Promise<void>}} [options] */
export declare function oldProfileTitle(page: Page, { onDrop, onRecovery }?: {
    onDrop?: () => void;
    onRecovery?: () => Promise<void>;
}): Promise<void>;
/**
 * One scenario, start to finish, in its own persistent profile.
 * @param {{ id: ScenarioId, title: string, browser: BrowserName }} scenario
 * @param {{ url: string, out: string, card: string, deepLink: string, oldProfile?: string, oldState?: StorageState, minClient?: string,
 *   watchMs?: number, budgetMs?: number, candidateBuild?: string, deploy?: boolean, pw: typeof import('playwright') }} options
 * K1 and K2 with no saved profile seed one (a fresh profile played into Driftwood) and report SKIP: there is no old cache yet.
 * @returns {Promise<ScenarioResult>}
 */
export function runScenario(scenario: {
    id: ScenarioId;
    title: string;
    browser: BrowserName;
}, { url, out, card, deepLink, oldProfile, oldState, minClient, watchMs, budgetMs, candidateBuild, deploy, cells, pw }: {
    url: string;
    out: string;
    card: string;
    deepLink: string;
    oldProfile?: string;
    oldState?: StorageState;
    minClient?: string;
    watchMs?: number;
    budgetMs?: number;
    candidateBuild?: string;
    deploy?: boolean;
    cells?: readonly string[];
    pw: typeof import("playwright");
}): Promise<ScenarioResult>;
/** Judge every play frame's world (worldFrame.mjs). @param {Record<string, string>} frames
 * @returns {Promise<Record<string, { stats: WorldStats, black: string | null }>>} */
export function judgeWorldFrames(frames: Record<string, string>): Promise<Record<string, {
    stats: WorldStats;
    black: string | null;
}>>;
/** The Shard Select cards a player can enter on this title, as slugs (the title's rows matched to the cards by name).
 * Leaves the page on Shard Select: the caller reopens the title. @param {Page} page @returns {Promise<string[]>} */
export function darkLampsProblem(grid: { inside?: unknown; sceneLife?: unknown } | null | undefined): string | null;
export function liveCells(page: Page): Promise<string[]>;
/** The recorded clip as an .mp4 (H.264, 15 fps), or the .webm when ffmpeg is missing.
 * @param {string} webm @param {string} mp4 @returns {string} */
/** Meta QA 11-25 row 62: leave the world through EXIT TO MAIN (the clean quit) so the next attempt finds no held body. */
export function leaveWorld(page: import('playwright').Page): Promise<string>;
export function toMp4(webm: string, mp4: string): string;
/** @typedef {import('playwright').Page} Page */
/** @typedef {import('playwright').BrowserContext} BrowserContext */
/** @typedef {import('../journey-proof.mjs').Sample} Sample */
/** @typedef {import('../journey-proof.mjs').Problem} Problem */
/** @typedef {'chromium' | 'webkit'} BrowserName */
/** @typedef {'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6'} ScenarioId */
/** @typedef {import('./worldFrame.mjs').WorldStats} WorldStats */
/** @typedef {{ kind: string, at: number, [key: string]: unknown }} ProbeEvent */
/** @typedef {{ name: string, at: number, samples: Sample[], problems: Problem[], path: string, tapAt: number, playAt: number | null, stick?: boolean, modals?: string[], documents?: number, requests?: { t: number, document: number, url: string, status: number | string }[], ends?: { t: number, document: number, reason: string }[] }} Leg */
/** @typedef {{ build?: string, caches: string[], databases: string[], clientVersion?: string }} StorageState */
/**
 * What one scenario saw. `status: 'skip'` carries only `reason`.
 * @typedef {{
 *   id: ScenarioId, title: string, browser: BrowserName, status: 'ran' | 'skip' | 'crashed', reason?: string,
 *   seconds: number, legs: Leg[], errors: string[], events: ProbeEvent[], log: string[], frames: Record<string, string>,
 *   video?: string, settings?: { opened: boolean, closed: boolean }, quietTitle?: { drop: boolean, left: boolean }, drops?: number,
 *   oldCache?: { before: StorageState, after: StorageState, minClient?: string }, profile?: string, endState?: StorageState,
 *   world?: Record<string, { stats: WorldStats, black: string | null }>,
 * }} ScenarioResult
 */
/** The kept set (plan SM0), in run order: one browser at a time (SB31: two headless browsers at once fake a RECONNECTING strip). */
export const SCENARIOS: readonly [{
    readonly id: "K1";
    readonly title: "old cache (Chromium)";
    readonly browser: "chromium";
}, {
    readonly id: "K2";
    readonly title: "old cache (WebKit)";
    readonly browser: "webkit";
}, {
    readonly id: "K3";
    readonly title: "Driftwood chain (WebKit)";
    readonly browser: "webkit";
}, {
    readonly id: "K4";
    readonly title: "deep link (WebKit)";
    readonly browser: "webkit";
}, {
    readonly id: "K5";
    readonly title: "Infinite Wildshard (WebKit)";
    readonly browser: "webkit";
}, {
    readonly id: "K6";
    readonly title: "every live cell at phone Low (WebKit)";
    readonly browser: "webkit";
}];
/** The six keyframes SM3 keeps per scenario, in contact-sheet order. */
export const KEYFRAMES: readonly string[];
/** Selectors the scenarios tap. The main screen is changing (J387, J399): keep them here, in one place. */
export const SEL: Readonly<{
    titleSelect: ".ws-main-select";
    settings: ".ws-main-settings:not(.ws-main-signin)";
    menuOpen: ".ws-gmenu.show";
    menuClose: ".ws-gmenu.show .ws-gmenu-close";
    pause: ".ws-touch-pause";
    exit: ".ws-gmenu.show .ws-gmenu-exit";
    dev: ".ws-main-dev";
    grid: ".ws-main-grid";
    play: ".ws-menu-play";
    skip: "#ws-name-box [data-name=skip]";
    drop: "#wsdrop";
    dropDismiss: "#wsdrop .dismiss";
}>;
/** SQ11: the latency K2 adds to every page request. */
export const SLOW_MS: 400;
export const K6_BUDGET_MS: 240000;
export const CELL_BUDGET_MS: 60000;
/** How long a cell plays before its world frame (the arrival reveal is 3 s on the grid; play has held 1.5 s by then). */
export const CELL_SETTLE_MS: 2500;
/** The frames whose world is judged (SB48): 10 s into play, and each K6 cell 4 s in (play1 can still be under the grid reveal). */
export const WORLD_FRAME: RegExp;
export function filesIn(dir: string): string[];
export type Page = import("playwright").Page;
export type BrowserContext = import("playwright").BrowserContext;
export type Sample = import("../journey-proof.mjs").Sample;
export type Problem = import("../journey-proof.mjs").Problem;
export type BrowserName = "chromium" | "webkit";
export type ScenarioId = "K1" | "K2" | "K3" | "K4" | "K5" | "K6";
export type WorldStats = import("./worldFrame.mjs").WorldStats;
export type ProbeEvent = {
    kind: string;
    at: number;
    [key: string]: unknown;
};
export type Leg = {
    name: string;
    at: number;
    samples: Sample[];
    problems: Problem[];
    path: string;
    tapAt: number;
    playAt: number | null;
    stick?: boolean;
    modals?: string[];
    blackWorld?: string;
    playedMs?: number;
    documents?: number;
    requests?: { t: number; document: number; url: string; status: number | string }[];
    ends?: { t: number; document: number; reason: string }[];
};
export type StorageState = {
    build?: string;
    caches: string[];
    databases: string[];
    clientVersion?: string;
};
/**
 * What one scenario saw. `status: 'skip'` carries only `reason`.
 */
export type ScenarioResult = {
    id: ScenarioId;
    title: string;
    browser: BrowserName;
    status: "ran" | "skip" | "crashed";
    reason?: string;
    seconds: number;
    legs: Leg[];
    errors: string[];
    events: ProbeEvent[];
    log: string[];
    frames: Record<string, string>;
    video?: string;
    settings?: {
        opened: boolean;
        closed: boolean;
    };
    quietTitle?: {
        drop: boolean;
        left: boolean;
    };
    drops?: number;
    oldCache?: {
        before: StorageState;
        after: StorageState;
        minClient?: string;
    };
    profile?: string;
    endState?: StorageState;
    world?: Record<string, {
        stats: WorldStats;
        black: string | null;
    }>;
    cells?: string[];
    load15?: number;
};
