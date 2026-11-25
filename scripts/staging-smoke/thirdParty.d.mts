// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/**
 * True when a page error message or a request URL belongs to the third-party analytics beacon, not to Wildshard.
 * @param {string} text @returns {boolean}
 */
export function isThirdPartyBeacon(text: string): boolean;
/**
 * The page errors that are ours: everything but the third-party analytics beacon's.
 * @param {readonly string[]} errors @returns {string[]}
 */
export function ownPageErrors(errors: readonly string[]): string[];
/** Cloudflare's Web Analytics hosts: the beacon script and its RUM endpoint. */
export const THIRD_PARTY_BEACON: RegExp;
