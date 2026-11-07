/** Concurrent owned commands; a first refusal stops its siblings. */
export function runChecks(commands: string[]): Promise<{command: string; code: number; sec: number; out: string}[]>;
