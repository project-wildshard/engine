/** Where a build's emitted shell is served from. */
export function standaloneDirectory(buildId: string): string;
/** The standalone shell and its server worker, under the build's folder. */
export function writeStandaloneOutput(outDir: string, buildId: string, root: string, options?: { preview?: boolean; devserver?: boolean }): Promise<void>;
export function standaloneServerFile(path: string): boolean;
export function checkServerOutput(outDir: string, preview: boolean): void;
