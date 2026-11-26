export const TITLE_MS: number;
export const FROZEN_MS: number;
export function verdict(documents: { build: string; mainAt: number; maxGap: number }[]): { titleMs: number | null; maxGap: number; builds: string[]; pass: boolean };
export function main(args: string[]): Promise<void>;
