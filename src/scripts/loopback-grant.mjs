// Meta QA 11-26 rows 75 and 80: the one place a harness gives a Chromium page leave to read another loopback port.
//
// Chromium's Local Network Access check (headless Chromium 158) sorts a page by the address its document came from. A page the
// online rig or a preview server serves itself is loopback, so its read of another loopback port (the rig's release file, a cook
// on a second origin) needs no leave: row 80 ran seat-hold-proof's Chromium page on the rig with no grant and it played. A page
// document a Playwright route serves (`route.fulfill`, as enterZone's `alone` one-cell page does) has no address, so Chromium
// counts it public and denies that read: "Permission was denied for this request to access the `loopback` address space". That
// stalled Nine's walk at loading step `server` on every memory-footprint run from 11-26 (row 75). So every route that serves a
// page document grants its origin `local-network-access` first, through this helper; test/loopback-grant.test.mjs refuses the
// permission named anywhere else and a routed one-cell page with no grant. WebKit and Firefox have no such check or permission.

/** @typedef {{ grantPermissions: (permissions: string[], options: { origin: string }) => Promise<void>,
 *    browser?: () => ({ browserType: () => { name: () => string } } | null) }} GrantContext */

/** Grant `origin`'s page `local-network-access` on a Chromium context (a persistent context, whose browser is unknown, too);
 *  nothing on WebKit or Firefox. @param {GrantContext} context @param {string} origin a URL on the page's origin */
export async function grantLoopback(context, origin) {
  const name = context.browser?.()?.browserType().name();
  if (name === 'webkit' || name === 'firefox') return;
  await context.grantPermissions(['local-network-access'], { origin: new URL(origin).origin });
}
