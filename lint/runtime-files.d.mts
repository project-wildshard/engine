export const RUNTIME_FILE_DEFAULT: 128;
export const RUNTIME_FILES_LIST: 'lint/runtime-files.json';
export interface RuntimeFilesRaise { slug: string; from: number; to: number; why: string }
export interface RuntimeFilesPolicy { about: string; default: 128; ceilings: Record<string, number>; raises: RuntimeFilesRaise[] }
/** Shape failures of a runtime-files policy, as messages. */
export function runtimeFilesShape(policy: unknown): string[];
/** The runtime/ source-file ceiling of a slug; the 128 default for any slug without a line. */
export function runtimeFileCeiling(policy: unknown, slug: string): number;
/** Read the checked-in policy of a checkout. */
export function readRuntimeFiles(root: string): unknown;
/** Shrink-only comparison of a candidate policy with its predecessor (undefined when new). */
export function compareRuntimeFiles(before: unknown, after: unknown): string[];
