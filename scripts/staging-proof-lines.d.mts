export interface PageLine { text: string; url?: string | undefined }
export function roomsHealthURL(socket: string): string | null;
export function isRoomsHealthLine(line: PageLine, healthURL: string | null): boolean;
export function splitRoomsHealthLines<T extends PageLine & { name?: string }>(lines: readonly T[], healthURL: string | null): { health: T[]; other: T[] };
export function playerNameSource(name: string): string;
export function isPlayerName(shown: string, name: string): boolean;
export function chatLinePattern(name: string, text: string): RegExp;
export function guardStagingSockets(allowed: string): void;
