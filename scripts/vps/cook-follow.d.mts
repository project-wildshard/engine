export interface CookRelease {
  tag: string;
  build: string;
}

export function signedCookRelease(text: string, key: string): CookRelease;
