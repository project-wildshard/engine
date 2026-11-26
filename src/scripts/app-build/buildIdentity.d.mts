/** The deploy stamp is read from the document; it never changes hashed module bytes. */
export const BUILD_ID_EXPRESSION: string;
export const VALIDATOR_EXPRESSION: string;
export const VERDICTS_EXPRESSION: string;
export interface DocumentAdmissionFacts { readonly validator: string; readonly verdicts: readonly unknown[]; readonly world?: { readonly release: string; readonly key: string; readonly recordTag?: string }; readonly preview?: true; readonly label?: string; readonly builtAt?: number }
/** The build pill's words (buildCheck.ts buildLabel): git describe, else "v<version> · <short sha>". */
export function buildLabelOf(build: string, release: { readonly version: string; readonly describe?: string }): string;
/** A new build's id: WS_BUILD_ID, else short git sha + build time. */
export function newBuildId(): string;
/** A known source's build id: short sha + build time (for exported trees, passed as WS_BUILD_ID). */
export function sourceBuildId(sha: string, now?: number): string;
/** A web build's own folder for code, CSS and wasm (J57, J131). */
export function codeDirectory(build: string): string;
export const SHARED_CODE_DIRECTORY: 'b/c';
/** QA-FEEDBACK 11-19 row 46: the offset after index.html's first-paint block (or `headEnd` when it has none), where the
 * build injects its head-start tags. */
export function afterFirstPaint(html: string, headEnd: number): number;
/** FIRST-OPEN-PROGRESS: the title document's bundle tags in one inert template, written back in place in a browser tab and
 * added after `load` on a Home Screen launch, so iOS drops its still launch image for the live shell at once. */
export function lateBootTags(html: string): string;
/** Stamp exactly one document head, refusing missing/duplicate/unsafe identities. */
export function stampBuildHtml(html: string, build: string, facts?: DocumentAdmissionFacts): string;
/** Stamp all built HTML entries from version.json before service-worker emission. */
export function stampBuildDocuments(directory: string, facts?: DocumentAdmissionFacts): void;
