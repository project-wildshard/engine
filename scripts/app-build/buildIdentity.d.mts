/** The deploy stamp is read from the document; it never changes hashed module bytes. */
export const BUILD_ID_EXPRESSION: string;
export const VALIDATOR_EXPRESSION: string;
export const VERDICTS_EXPRESSION: string;
export interface DocumentAdmissionFacts { readonly validator: string; readonly verdicts: readonly unknown[] }
/** A new build's id: short git sha + build time. */
export function newBuildId(): string;
/** A web build's own folder for code, CSS and wasm (J57, J131). */
export function codeDirectory(build: string): string;
/** Stamp exactly one document head, refusing missing/duplicate/unsafe identities. */
export function stampBuildHtml(html: string, build: string, facts?: DocumentAdmissionFacts): string;
/** Stamp all built HTML entries from version.json before service-worker emission. */
export function stampBuildDocuments(directory: string, facts?: DocumentAdmissionFacts): void;
