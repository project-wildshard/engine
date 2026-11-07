export const PLATFORM_LISTS: readonly string[];
export function comparePlatformList(list: string, baselineFile: string, candidateFile: string, trees?: { baselineRoot: string; candidateRoot: string },
  sources?: {
    before: (file: string) => string | undefined;
    after: (file: string) => string | undefined;
  }): string[];
export function checkPlatformRatchets(baselineRoot: string, candidateRoot: string): string[];
