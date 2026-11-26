// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-definitions, typescript/consistent-type-imports -- tsc's declaration output */
/** @typedef {import('./checks.mjs').Finding & { sheet?: string }} BoardFinding */
/** @typedef {{ scenario: string, verdict: string, severity?: string, line: string, bullet?: string, sheet?: string }} BoardVision */
/**
 * @typedef {{ release: string, build?: string, url?: string, at?: string, seconds: number, last?: string, hold: boolean,
 *   scenarios: { id: string, title: string, status: string, reason?: string, seconds: number, timeToPlay?: number, frames: Record<string, string>, video?: string }[],
 *   findings: BoardFinding[], vision?: BoardVision[], bugbash?: { added: string[], seenAgain: string[], rowOf?: Record<string, string> } }} BoardVerdict
 */
/** True when nothing changed: no findings and every vision verdict same or baseline. @param {BoardVerdict} v */
export function isClean(v: BoardVerdict): boolean;
/** The one receipt line of a clean run. @param {BoardVerdict} v @param {Date} [now] */
export function receiptLine(v: BoardVerdict, now?: Date): string;
/**
 * Write <out>/board.html (and its clips under <out>/clips/) for a run that found something; returns the file.
 * @param {BoardVerdict} v @param {{ out: string, lastDir?: string }} o
 */
export function writeBoard(v: BoardVerdict, { out, lastDir }: {
    out: string;
    lastDir?: string;
}): string;
export type BoardFinding = import("./checks.mjs").Finding & {
    sheet?: string;
};
export type BoardVision = {
    scenario: string;
    verdict: string;
    severity?: string;
    line: string;
    bullet?: string;
    sheet?: string;
};
export type BoardVerdict = {
    release: string;
    build?: string;
    url?: string;
    at?: string;
    seconds: number;
    last?: string;
    hold: boolean;
    scenarios: {
        id: string;
        title: string;
        status: string;
        reason?: string;
        seconds: number;
        timeToPlay?: number;
        frames: Record<string, string>;
        video?: string;
    }[];
    findings: BoardFinding[];
    vision?: BoardVision[];
    bugbash?: {
        added: string[];
        seenAgain: string[];
        rowOf?: Record<string, string>;
    };
};
