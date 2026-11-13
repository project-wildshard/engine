/** STALE-BUILD SB1 (J321, Jake 2026-11-13: "we must stamp in the actual date and time of that code, in both the HTML and
 * the JavaScript"): the one build time, in ms, every stamp of a build carries. build-app fixes it once in WS_BUILT_AT, so
 * version.json, the documents, the page's entry and sw.js agree to the millisecond.
 * @param {string | undefined} requested @param {number} [now] */
export function builtAtOf(requested, now = Date.now()) {
  if (requested === undefined || requested === '') return String(now);
  if (!/^\d{12,14}$/u.test(requested)) throw new Error('Invalid WS_BUILT_AT (ms since 1970)');
  return requested;
}

/** STALE-BUILD SB3: the first statement of the page's own entry (`b/<build>/main-*.js`, a file per build, so no shared
 * chunk's bytes move): its build time, then the check. With strictExecutionOrder every module body waits for the entry's
 * call, so this runs before any of them. A stamp unlike the document's is marked; over 21 days, index.html's
 * `data-stale-build` screen takes the page (it may let a build through when the server says the device clock is wrong)
 * and the throw stops every module: no menu, no game. Off build-app (dev, tests) there is no stamp and no banner.
 * @param {string | undefined} builtAt WS_BUILT_AT */
export function entryStamp(builtAt) {
  if (builtAt === undefined || !/^\d{12,14}$/u.test(builtAt)) return '';
  return `globalThis.__WS_ENTRY_BUILT_AT__=${builtAt};if(globalThis.__WS_BUILT_AT__!==${builtAt})document.documentElement.dataset.stampMismatch=String(globalThis.__WS_BUILT_AT__);`
    + `if(globalThis.__wsStaleBuild?.(${builtAt})===true){document.documentElement.dataset.booted="";throw new Error("STALE-BUILD: this build is over 21 days old; only the forced update runs")}`;
}
