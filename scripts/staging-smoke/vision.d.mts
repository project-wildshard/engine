// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-definitions, typescript/consistent-type-imports -- tsc's declaration output */
/**
 * A two-row sheet: `top` (last release) over `bottom` (this one), one column per keyframe; a missing frame is black.
 * @param {readonly (string | undefined)[]} top @param {readonly (string | undefined)[]} bottom @param {string} out
 */
export function contactSheet(top: readonly (string | undefined)[], bottom: readonly (string | undefined)[], out: string): string;
/** The prompt for one scenario. @param {{ sheet: string, scenario: string, title: string, last: string, release: string, bullets: readonly string[] }} o */
export function visionPrompt({ sheet, scenario, title, last, release, bullets, columns }: {
    sheet: string;
    scenario: string;
    title: string;
    last: string;
    release: string;
    bullets: readonly string[];
    columns?: string;
}): string;
/** J474: how a judge is reached: the herdr binary (a stub in the test), its timeout, the environment (HERDR_ENV, HERDR_PANE_ID). */
export type JudgeOptions = { herdr?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; workRoot?: string };
/** The judge's own Claude arguments: Opus, Read and Write, no added folders; never -p / --print (J474). */
export function judgeArgs(): string[];
/** The prompt's last line: write the verdict JSON to `file`. */
export function writeVerdict(file: string): string;
/** J474: one Opus judge, an interactive Claude in a no-focus herdr pane; `skipped` with no herdr. */
export function askJudge(promptFor: (sheet: string) => string, sheet: string, verdictFile: string, o?: JudgeOptions): Promise<Omit<Vision, "scenario">>;
/** STAGING-QA SQ13: the most judges one deploy run starts, and how many at once. */
export const VISION_MAX_CALLS: 12;
export const VISION_PARALLEL: 2;
/** SQ13, the deploy judge (report-only): skips held scenarios, at most `maxCalls` calls, `parallel` at a time. */
export function deployVision(o: {
    scenarios: readonly { id: string; title: string; status: string; frames: Record<string, string>; cells?: readonly string[] }[];
    held: ReadonlySet<string>;
    release: string;
    last?: { release: string; dir: string };
    bullets: readonly string[];
    out: string;
    maxCalls?: number;
    parallel?: number;
} & JudgeOptions): Promise<Vision[]>;
/** The last JSON object in a model reply, checked. @param {string} text @returns {Omit<Vision, 'scenario'> | undefined} */
export function parseVision(text: string): Omit<Vision, "scenario"> | undefined;
/** The release's changelog bullets from CHANGELOG.md (`## vX.Y.Z (date)` then `- ` lines). @param {string} file @param {string} release */
export function changelogBullets(file: string, release: string): string[];
/** The vision pass over every scenario that ran: a sheet each against the last release's frames, then one judge, in turn. */
export function visionPass(o: {
    scenarios: readonly {
        id: string;
        title: string;
        status: string;
        frames: Record<string, string>;
    }[];
    release: string;
    last?: {
        release: string;
        dir: string;
    };
    bullets: readonly string[];
    out: string;
} & JudgeOptions): Promise<Vision[]>;
/** Regressions as findings (severity from the model, P1 when it gave none). @param {readonly Vision[]} vision */
export function visionFindings(vision: readonly Vision[]): (import("./checks.mjs").Finding & {
    sheet?: string;
})[];
/** @typedef {'same' | 'changed' | 'regressed' | 'baseline' | 'error' | 'skipped'} VisionVerdict */
/** @typedef {{ scenario: string, verdict: VisionVerdict, severity?: 'P0' | 'P1' | 'P2', bullet?: string, line: string, sheet?: string }} Vision */
export const VISION_MODEL: "claude-opus-5-5";
export type VisionVerdict = "same" | "changed" | "regressed" | "baseline" | "error" | "skipped";
export type Vision = {
    scenario: string;
    verdict: VisionVerdict;
    severity?: "P0" | "P1" | "P2";
    bullet?: string;
    line: string;
    sheet?: string;
};
