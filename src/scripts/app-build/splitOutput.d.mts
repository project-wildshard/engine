/** PAGE-SIZE PZ4: the page (`dist/`) and its content (`dist-content/`), and the join back into one tree. */
export function contentDirOf(dist: string): string;
export function isContent(path: string, shards: ReadonlySet<string>): boolean;
export function splitOutput(dist: string, content?: string): {files: number; bytes: number};
/** QA 11-25 row 121 (P0): content paths the page holds that the set's index lacks. */
export function contentGaps(dist: string, held: ReadonlySet<string>): string[];
export function joinOutput(dist: string, content?: string): {files: number; bytes: number};
export function shardContent(dist: string, content?: string): string[];
export const SPLITTING: string;
