export const RELEASES_ORIGIN = 'https://releases.wildshard.io';
const PACKS_ORIGIN = 'https://packs.wildshard.io';

/** A production stamp, including stamps in pages built before the release bucket split. */
export function isProductionRelease(release: string): boolean {
  if (/\/releases\/production\.json(?:[?#]|$)/u.test(release)) return true;
  try {
    const address = new URL(release);
    return address.origin === RELEASES_ORIGIN && address.pathname === '/production.json';
  } catch { return false; }
}

/** Pack books stay on the packs origin. Local fixtures can still serve both from one origin. */
export function packsOriginForRelease(release: string): string {
  const address = new URL('/', release);
  return address.origin === RELEASES_ORIGIN ? `${PACKS_ORIGIN}/` : address.href;
}
