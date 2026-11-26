export function precommitInputs(root?: string, executable?: string): Promise<void>;
/** Read a complete Git inventory with an explicit capture bound, without index writes. */
export function precommitGit(root: string, args: string[]): string;
export function missingInventoryGeneration(root: string, guard: string): string[];
export function ignoredBy(file: string, pattern: string): boolean;
