export function excludeText(text: string, paths: readonly string[]): string;
export function excludedPaths(text: string): Set<string>;
export function excludePublished(paths: readonly string[], cwd?: string): { written: boolean; uncovered: number };
