interface CookRelease { tag: string; build: string }
export function selectCookRelease(staging: CookRelease, production: CookRelease, request: {build: string} | {tag: string}): CookRelease;
