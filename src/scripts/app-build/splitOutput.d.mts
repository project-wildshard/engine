/** PAGE-SIZE PZ4: the page (`dist/`) and its content (`dist-content/`), and the join back into one tree. */
export function contentDirOf(dist: string): string;
export function isContent(path: string, shards: ReadonlySet<string>): boolean;
export function splitOutput(dist: string, content?: string): {files: number; bytes: number};
export function joinOutput(dist: string, content?: string): {files: number; bytes: number};
export const SPLITTING: string;
