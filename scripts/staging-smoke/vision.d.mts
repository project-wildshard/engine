// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-definitions, typescript/consistent-type-imports -- tsc's declaration output */
/**
 * A two-row sheet: `top` (last release) over `bottom` (this one), one column per keyframe; a missing frame is black.
 * @param {readonly (string | undefined)[]} top @param {readonly (string | undefined)[]} bottom @param {string} out
 */
export function contactSheet(top: readonly (string | undefined)[], bottom: readonly (string | undefined)[], out: string): string;
/** The prompt for one scenario. @param {{ sheet: string, scenario: string, title: string, last: string, release: string, bullets: readonly string[] }} o */
export function visionPrompt({ sheet, scenario, title, last, release, bullets }: {
    sheet: string;
    scenario: string;
    title: string;
    last: string;
    release: string;
    bullets: readonly string[];
}): string;
/** The last JSON object in a model reply, checked. @param {string} text @returns {Omit<Vision, 'scenario'> | undefined} */
export function parseVision(text: string): Omit<Vision, "scenario"> | undefined;
/**
 * Ask Claude about one sheet. `claude` is whatever is first on PATH (the test puts a stub there). The call runs in the sheet's
 * folder (outside any repo, so no project instructions load) with only the Read tool.
 * @param {string} prompt @param {string} cwd @param {{ claude?: string, timeoutMs?: number }} [o] @returns {Omit<Vision, 'scenario'>}
 */
export function askClaude(prompt: string, cwd: string, { claude, timeoutMs }?: {
    claude?: string;
    timeoutMs?: number;
}): Omit<Vision, "scenario">;
/** The release's changelog bullets from CHANGELOG.md (`## vX.Y.Z (date)` then `- ` lines). @param {string} file @param {string} release */
export function changelogBullets(file: string, release: string): string[];
/**
 * The vision pass over every scenario that ran: a sheet each against the last release's frames, then one call.
 * @param {{ scenarios: readonly { id: string, title: string, status: string, frames: Record<string, string> }[], release: string,
 *   last?: { release: string, dir: string }, bullets: readonly string[], out: string, claude?: string }} o @returns {Vision[]}
 */
export function visionPass({ scenarios, release, last, bullets, out, claude }: {
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
    claude?: string;
}): Vision[];
/** Regressions as findings (severity from the model, P1 when it gave none). @param {readonly Vision[]} vision */
export function visionFindings(vision: readonly Vision[]): (import("./checks.mjs").Finding & {
    sheet?: string;
})[];
/** @typedef {'same' | 'changed' | 'regressed' | 'baseline' | 'error'} VisionVerdict */
/** @typedef {{ scenario: string, verdict: VisionVerdict, severity?: 'P0' | 'P1' | 'P2', bullet?: string, line: string, sheet?: string }} Vision */
export const VISION_MODEL: "claude-opus-5-5";
export type VisionVerdict = "same" | "changed" | "regressed" | "baseline" | "error";
export type Vision = {
    scenario: string;
    verdict: VisionVerdict;
    severity?: "P0" | "P1" | "P2";
    bullet?: string;
    line: string;
    sheet?: string;
};
