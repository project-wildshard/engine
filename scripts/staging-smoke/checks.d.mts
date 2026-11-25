// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-definitions, typescript/consistent-type-imports -- tsc's declaration output */
/** STAGING-QA SQ12 (SB47's done-when): a return visit to Driftwood at Low Power reaches play within this, or it is a P1. */
export const RETURN_PLAY_BUDGET_MS: 20000;
/** SQ12: time to play over this share of the last release's is a P2 on a deploy. */
export const SLOWER_SHARE: 1.25;
/** Each leg's milliseconds from its tap to play, by leg name. */
export function legTimes(s: ScenarioResult): Record<string, number>;
/** SQ12 on a deploy: K2's return visit inside its budget (P1), and each leg within SLOWER_SHARE of the last release's (P2). */
export function loadChecks(s: ScenarioResult, last: Record<string, number> | undefined, noisyLoad?: number): Check[];
/** Meta QA 11-25 row 60: over this 15-minute load per CPU, a missed load time is "noisy, rerun" (P2), not a hold. */
export const NOISY_LOAD_PER_CPU: 0.75;
/** A timing check with the load beside it; over `noisyLoad` a miss reads "noisy, rerun" (P2). */
export function underLoad(check: Check, load15: number | undefined, noisyLoad: number | undefined): Check;
/** a.b.c below x.y.z @param {string} a @param {string} b */
export function olderVersion(a: string, b: string): boolean;
/** Milliseconds from the first leg's tap to play, or undefined when it never played. @param {ScenarioResult} s */
export function timeToPlay(s: ScenarioResult): number | undefined;
/**
 * Every check for one scenario, passed or not. A skipped scenario has none.
 * @param {ScenarioResult} s @param {CheckContext} ctx @returns {Check[]}
 */
export function checkScenario(s: ScenarioResult, ctx: CheckContext): Check[];
/** The failed checks as findings, worst first. @param {ScenarioResult} s @param {Check[]} checks @returns {Finding[]} */
export function findingsOf(s: ScenarioResult, checks: Check[]): Finding[];
/**
 * The verdict: scenarios with their checks, every finding, and whether it holds prod.
 * @param {readonly ScenarioResult[]} scenarios @param {CheckContext} ctx
 */
export function verdictOf(scenarios: readonly ScenarioResult[], ctx: CheckContext): {
    rows: {
        timeToPlay?: number | undefined;
        scenario: import("./scenarios.mjs").ScenarioResult;
        checks: Check[];
        findings: Finding[];
        legTimes: Record<string, number>;
        load15?: number | undefined;
    }[];
    findings: Finding[];
    hold: boolean;
};
/** Runs in the page: which modal is up, for watchLeg. @returns {'error' | 'drop' | null} */
export function modalKind(): "error" | "drop" | null;
export function worstFirst(a: Finding, b: Finding): number;
export function holds(findings: readonly Finding[]): boolean;
export type Severity = "P0" | "P1" | "P2";
export type Check = {
    key: string;
    severity: Severity;
    ok: boolean;
    text: string;
    frame?: string;
};
export type Finding = {
    scenario: string;
    key: string;
    severity: Severity;
    text: string;
    source: "check" | "vision";
    frame?: string;
    video?: string;
};
export type ScenarioResult = import("./scenarios.mjs").ScenarioResult;
export type Version = {
    build?: string;
    describe?: string;
    clientVersion?: string;
    minClient?: string;
};
export type CheckContext = {
    release: string;
    version: Version;
    build?: string;
    lastTimeToPlay?: Record<string, number>;
    checkVersion?: boolean;
    deploy?: boolean;
    noisyLoad?: number;
};
