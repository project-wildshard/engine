/** The deploy stamp is read from the document; it never changes hashed module bytes. */
export const BUILD_ID_EXPRESSION: string;
export const VALIDATOR_EXPRESSION: string;
export const VERDICTS_EXPRESSION: string;
export interface DocumentAdmissionFacts { readonly validator: string; readonly verdicts: readonly unknown[]; readonly world?: { readonly release: string; readonly key: string; readonly recordTag?: string }; readonly label?: string; readonly builtAt?: number }
/** The build pill's words (buildCheck.ts buildLabel): git describe, else "v<version> · <short sha>". */
export function buildLabelOf(build: string, release: { readonly version: string; readonly describe?: string }): string;
/** A new build's id: WS_BUILD_ID, else short git sha + build time. */
export function newBuildId(): string;
/** A known source's build id: short sha + build time (for exported trees, passed as WS_BUILD_ID). */
export function sourceBuildId(sha: string, now?: number): string;
/** A web build's own folder for code, CSS and wasm (J57, J131). */
export function codeDirectory(build: string): string;
export const SHARED_CODE_DIRECTORY: 'b/c';
/** Stamp exactly one document head, refusing missing/duplicate/unsafe identities. */
export function stampBuildHtml(html: string, build: string, facts?: DocumentAdmissionFacts): string;
/** Stamp all built HTML entries from version.json before service-worker emission. */
export function stampBuildDocuments(directory: string, facts?: DocumentAdmissionFacts): void;
