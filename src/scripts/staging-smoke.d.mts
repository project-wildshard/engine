// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-imports -- tsc's declaration output */
/** @param {readonly string[]} argv @returns {Map<string, string>} */
export function parseArgs(argv: readonly string[]): Map<string, string>;
/** What the candidate's /version.json says, or {} when it has none.
 * @param {string} url @returns {Promise<{ build?: string, describe?: string, clientVersion?: string, minClient?: string }>} */
export function served(url: string): Promise<{
    build?: string;
    describe?: string;
    clientVersion?: string;
    minClient?: string;
}>;
/**
 * Run the smoke and write <out>/verdict.json.
 * @param {{ url: string, release: string, out: string, only?: readonly string[], card?: string, deepLink?: string, watchMs?: number, budgetMs?: number,
 *   build?: string, lastTimeToPlay?: Record<string, number>, oldProfiles?: Partial<Record<'chromium' | 'webkit', string>>,
 *   oldState?: import('./staging-smoke/scenarios.mjs').StorageState, store?: string, vision?: boolean, deploy?: boolean, changelog?: string, bugbash?: string, receipts?: string, runBudgetS?: number,
 *   log?: (line: string) => void }} options
 * `store` (the CLI's default: ~/.cache/wildshard/plan-artifacts/staging-smoke) keeps the run and gives the last release's
 * frames and times; without one the run is kept only in `out` and the vision pass has no baseline (no calls).
 */
export function runSmoke({ url, release, out, only, cells, card, deepLink, watchMs, budgetMs, build, lastTimeToPlay, oldProfiles, oldState, store, vision, deploy, changelog, bugbash, receipts, runBudgetS, log }: {
    url: string;
    release: string;
    out: string;
    only?: readonly string[];
    cells?: readonly string[];
    card?: string;
    deepLink?: string;
    watchMs?: number;
    budgetMs?: number;
    build?: string;
    lastTimeToPlay?: Record<string, number>;
    oldProfiles?: Partial<Record<"chromium" | "webkit", string>>;
    oldState?: import("./staging-smoke/scenarios.mjs").StorageState;
    store?: string;
    vision?: boolean;
    deploy?: boolean;
    changelog?: string;
    bugbash?: string;
    receipts?: string;
    runBudgetS?: number;
    log?: (line: string) => void;
}): Promise<{
    vision: import("./staging-smoke/vision.mjs").Vision[];
    findings: import("./staging-smoke/checks.mjs").Finding[];
    hold: boolean;
    last?: string | undefined;
    version: {
        build?: string;
        describe?: string;
        clientVersion?: string;
        minClient?: string;
    };
    at: string;
    seconds: number;
    scenarios: (import("./staging-smoke/scenarios.mjs").ScenarioResult & {
        checks: import("./staging-smoke/checks.mjs").Check[];
        timeToPlay: number | undefined;
    })[];
    describe?: string | undefined;
    build?: string | undefined;
    url: string;
    release: string;
}>;
/** The whole run's budget (SM8 (d)): over this the runner warns. */
export const RUN_BUDGET_S: 600;
