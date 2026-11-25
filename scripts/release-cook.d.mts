interface CookRelease { tag: string; build: string }
export function selectCookRelease(staging: CookRelease, production: CookRelease, request: {build: string} | {tag: string}): CookRelease;
export function hardenDue(applied: string | undefined, build: string, changed: (from: string, to: string) => string[] | null): {due: boolean; why: string};
