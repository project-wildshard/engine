// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-imports -- tsc's declaration output */
/**
 * SM8's bar, answered for a finding (the "scenario?" field): a new bug becomes a scenario only if it is P0 or P1, no kept
 * scenario's check or vision pass caught it, T1 or the J386 gate cannot hold it, and it adds at most 45 s. A smoke finding
 * was caught by a kept scenario, so the answer is always no; the field says which check holds it.
 * @param {Finding} f
 */
export function scenarioAnswer(f: Finding): string;
/**
 * The plan file with this run's findings written in.
 * @param {string} plan the STAGING-BUGBASH plan's text
 * @param {readonly Finding[]} findings
 * @param {{ release: string, build?: string }} run
 * @returns {{ text: string, added: string[], seenAgain: string[], rowOf: Record<string, string> }}
 */
export function bugbashRows(plan: string, findings: readonly Finding[], { release, build }: {
    release: string;
    build?: string;
}): {
    text: string;
    added: string[];
    seenAgain: string[];
    rowOf: Record<string, string>;
};
export function smokeKey(f: Pick<Finding, "scenario" | "key">): string;
export type Finding = import("./checks.mjs").Finding;
