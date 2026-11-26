// Meta QA 11-25 row 16: staging pages carry Cloudflare's Web Analytics beacon (static.cloudflareinsights.com, posting to
// cloudflareinsights.com/cdn-cgi/rum). Headless WebKit refuses its cross-origin post "due to access control checks" and
// reports it as an uncaught page error, which held K6 on a P1 that is not ours. Every staging check that judges page
// errors or foreign requests reads this one rule, so the beacon is ignored the same way everywhere (11-24 row 65's
// hud-worst reuses it).

/** Cloudflare's Web Analytics hosts: the beacon script and its RUM endpoint. */
export const THIRD_PARTY_BEACON = /\bcloudflareinsights\.com\b/u;

/**
 * True when a page error message or a request URL belongs to the third-party analytics beacon, not to Wildshard.
 * @param {string} text @returns {boolean}
 */
export function isThirdPartyBeacon(text) {
  return THIRD_PARTY_BEACON.test(text);
}

/**
 * The page errors that are ours: everything but the third-party analytics beacon's.
 * @param {readonly string[]} errors @returns {string[]}
 */
export function ownPageErrors(errors) {
  return errors.filter((e) => !isThirdPartyBeacon(e));
}
