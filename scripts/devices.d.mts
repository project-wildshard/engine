/** The `client.device` lines in a journal's text, oldest first. */
export function deviceLines(text: string): Record<string, unknown>[];
/** The lines as a fixed-width table. */
export function deviceTable(lines: readonly Record<string, unknown>[]): string;
