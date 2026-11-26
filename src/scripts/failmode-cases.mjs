// FM3 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): the case manifest of the failure proof. Every one of the catalogue's 46 modes has a
// stable scenario name, its runtime owner row, the phase it happens in, how failmode-proof.mjs injects it, the screen a player must see
// (`data-failmode`, which may carry several ids: `drop reset`) and how it recovers. A `b` hold card and too-old's banner/page variant sit
// under their parent; they are not new numeric modes. `run` names the proof's runner; a case with no runner records why (`blocked`:
// its runtime row or contract isn't built; `unsupported`: this engine or harness can't produce the fault honestly). Neither is a pass.

/** @typedef {'boot' | 'load' | 'play' | 'title' | 'doctor'} Phase */
/** @typedef {'pass' | 'ui-fail' | 'blocked-dependency' | 'unsupported' | 'harness-fail'} Outcome */
/** @typedef {{ mode: string, id: string, owner: string, phase: Phase, screen: string, inject: string, recover: string, deadlineMs: number, run?: string,
 *   blocked?: string, chromiumOnly?: boolean, parent?: string }} Case */

/** @type {readonly Case[]} */
export const CASES = Object.freeze([
  // J298 amends mode 1: a world build holding a cached world loads it from cache and shows mode 2's card; mode 1's page is only for a page
  // with nothing cached, which can't render its own screen (the browser's offline page). So a warmed world must show `offline-play`.
  { mode: '1', id: 'offline-launch', owner: 'FM5', phase: 'boot', screen: 'offline-play', inject: 'warm the service worker in the world, then setOffline and reload', recover: 'online: a frame, no card', run: 'offlineLaunch' },
  { mode: '2', id: 'offline-play', owner: 'FM4b', phase: 'play', screen: 'offline-play', inject: 'context.setOffline(true) in the world', recover: 'online: a frame, no card', run: 'offlinePlay' },
  { mode: '3', id: 'background-short', owner: 'FM4', phase: 'play', screen: 'background-short', inject: 'CDP freeze 4 s (server stalls the socket at 3 s)', recover: 'first frame: reconnected', run: 'freeze', chromiumOnly: true },
  { mode: '3b', id: 'background-short/blocked', parent: 'background-short', owner: 'FM4', phase: 'play', screen: 'background-short-blocked', inject: 'Interact while 3 shows', recover: 'closes on the first frame', blocked: 'the harness drives no in-world tap under a banner yet (test/net-strip-browser.test.ts covers the tap on a real room)' },
  { mode: '4', id: 'background-long', owner: 'FM4b', phase: 'play', screen: 'background-long', inject: 'CDP hidden 35 s (visibility changes)', recover: 'seated again: no card', run: 'freeze', chromiumOnly: true },
  // FM4b (opus-fm, 2026-11-18): the page can't tell 5 to 8 apart (one 1006 close each), so all four are one `unreachable` card, shown
  // for a link that never reached the world after 10 s down while online (a link that was live stays FM4's banner); the scenario names
  // the injected cause, the screen never does
  { mode: '5', id: 'unreachable', owner: 'FM4b', phase: 'play', screen: 'unreachable', inject: 'refuse-upgrade 503 from the first dial', recover: 'heal: seated by itself', run: 'unreachable' },
  { mode: '6', id: 'dns', owner: 'FM4b', phase: 'play', screen: 'unreachable', inject: 'the page\'s signed release names a .invalid socket (a negative DNS target)', recover: 'release names the world again, Try now: seated', run: 'unreachable' },
  { mode: '7', id: 'tls', owner: 'FM4b', phase: 'play', screen: 'unreachable', inject: 'the page\'s signed release names the proxy\'s self-signed fixture TLS listener', recover: 'release names the world again, Try now: seated', run: 'unreachable' },
  { mode: '8', id: 'upgrade-refused', owner: 'FM4b', phase: 'play', screen: 'unreachable', inject: 'refuse-upgrade 502 from the first dial', recover: 'heal: seated by itself', run: 'unreachable' },
  { mode: '9', id: 'restart', owner: 'FM4', phase: 'play', screen: 'restart', inject: 'socket close 4005 on every connection for 4 s', recover: 'heal: reconnected', run: 'socketDown' },
  { mode: '9b', id: 'restart/blocked', parent: 'restart', owner: 'FM4', phase: 'title', screen: 'restart-blocked', inject: 'Play on the title while 9 shows', recover: 'joins by itself', run: 'titleHold' },
  { mode: '10', id: 'deploy', owner: 'FM4', phase: 'play', screen: 'deploy', inject: 'the rig moves to its second build (--next): a newer signed release', recover: 'the page reloads into it and plays', run: 'deploy' },
  { mode: '10b', id: 'deploy/blocked', parent: 'deploy', owner: 'FM4', phase: 'title', screen: 'deploy-blocked', inject: 'Enter world in the move\'s grace, in a tab that heard a restart (--next)', recover: 'joins the second build by itself', run: 'deployHold' },
  { mode: '11', id: 'release-5xx', owner: 'FM5', phase: 'boot', screen: 'release-5xx', inject: 'release status 503 before navigation', recover: 'heal: the world loads by itself', run: 'releaseFault' },
  { mode: '12', id: 'release-429', owner: 'FM5', phase: 'boot', screen: 'release-429', inject: 'release status 429, Retry-After 3', recover: 'heal: the world loads after Retry-After', run: 'releaseFault' },
  { mode: '13', id: 'version-http', owner: 'FM5', phase: 'play', screen: 'version-http', inject: 'version.json status 503 (Developer on); Settings ▸ Build ▸ Check runs the poll\'s read', recover: 'heal: the next read clears it', run: 'versionHttp' },
  { mode: '14', id: 'doctor-http', owner: 'FM8', phase: 'doctor', screen: 'doctor-http', inject: 'doctor status 503, then Check connection in the world', recover: 'heal, Try again: the doctor opens', run: 'doctorHttp' },
  { mode: '15', id: 'drop', owner: 'FM4', phase: 'play', screen: 'drop', inject: 'socket drop-after 0 (terminated: 1006), then refuse-upgrade for 2 s', recover: 'heal: reconnected chip', run: 'socketDown' },
  { mode: '15b', id: 'drop/blocked', parent: 'drop', owner: 'FM4', phase: 'play', screen: 'drop-blocked', inject: 'Attack (key F) while 15 shows', recover: 'closes on the first frame', run: 'heldTap' },
  { mode: '16', id: 'reset', owner: 'FM4', phase: 'play', screen: 'drop', inject: 'socket drop-after 0 (a reset is a 1006 to the page)', recover: 'heal: reconnected chip', run: 'socketDown' },
  { mode: '16b', id: 'reset/blocked', parent: 'reset', owner: 'FM4', phase: 'play', screen: 'reset-blocked', inject: 'Send in chat while 16 shows', recover: 'the held line sends once', run: 'heldChat' },
  { mode: '17', id: 'half-open', owner: 'FM4', phase: 'play', screen: 'half-open', inject: 'socket half-open (no downstream frames or pongs)', recover: 'heal: reconnected chip', run: 'socketDown' },
  { mode: '17b', id: 'half-open/blocked', parent: 'half-open', owner: 'FM4', phase: 'play', screen: 'half-open-blocked', inject: 'Attack (key F) while 17 shows', recover: 'closes on the first frame', run: 'heldTap' },
  { mode: '18', id: 'reconnected', owner: 'FM4', phase: 'play', screen: 'reconnected', inject: 'a 2 s drop', recover: 'the chip goes by itself', run: 'socketDown' },
  { mode: '19', id: 'resuming', owner: 'FM4', phase: 'play', screen: 'resuming', inject: 'drop, then refuse-upgrade 503 for 37 s', recover: 'heal: reconnected', run: 'socketDown' },
  { mode: '19b', id: 'resuming/blocked', parent: 'resuming', owner: 'FM4', phase: 'play', screen: 'resuming-blocked', inject: 'Attack (key F) after 35 s down', recover: 'closes on the first frame', run: 'heldTap' },
  { mode: '20', id: 'lost', owner: 'FM4', phase: 'play', screen: 'lost', inject: 'drop, then refuse-upgrade 503 for 122 s', recover: 'heal, Try again: seated', run: 'socketDown' },
  { mode: '21', id: 'slow', owner: 'FM4b', phase: 'play', screen: 'slow', inject: 'delay-frames 160 ms both ways (RTT over 250 ms)', recover: 'heal: clears after 10 good seconds', run: 'linkQuality' },
  { mode: '22', id: 'lossy', owner: 'FM4b', phase: 'play', screen: 'lossy', inject: 'downstream delay-frames swinging 20 ms / 420 ms every 2.5 s (RTT span over 250 ms)', recover: 'heal: clears after 10 good seconds', run: 'linkQuality' },
  { mode: '23', id: 'version-skew', owner: 'FM5', phase: 'play', screen: 'version-skew', inject: 'socket close 4000 (reload) on every connection', recover: 'one reload, then the page', run: 'socketDown' },
  { mode: '24', id: 'too-old', owner: 'FM5b', phase: 'play', screen: 'too-old-warning', inject: 'a signed retention file keeping only the second build (--next), the page\'s release view on it', recover: 'next load: too-old page; Update plays on the second build', run: 'tooOld' },
  { mode: '25', id: 'full', owner: 'FM4', phase: 'play', screen: 'full', inject: '--seats=2: the door full with two pages, two more in its line (else socket close 4002 for 3 s)', recover: 'Title cancels the ticket ahead; a freed seat lets the head in', run: 'queue' },
  { mode: '26', id: 'replaced', owner: 'FM4', phase: 'play', screen: 'replaced', inject: 'a second tab of the same device takes the seat', recover: 'Play here: seated', run: 'replaced' },
  { mode: '27', id: 'auth-expired', owner: 'FM8b', phase: 'play', screen: 'auth-expired', inject: 'the owned local API ends every session (its own 401), then one drop of the world socket', recover: 'Sign in by a fresh mailed link: rejoins as the account; Play as a guest: rejoins as the device', run: 'authExpired' },
  { mode: '28', id: 'auth-failed', owner: 'FM8b', phase: 'title', screen: 'auth-failed', inject: 'a mailed link the owned local API refuses (401: spent or unknown)', recover: 'Email me a new link: signed in', run: 'authFailed' },
  { mode: '29', id: 'api-5xx', owner: 'FM8b', phase: 'title', screen: 'api-5xx', inject: 'the proxy answers 503 on the account API', recover: 'Play as a guest closes; heal, Try now: the link is sent', run: 'api5xx' },
  { mode: '30', id: 'save-slow', owner: 'FM8s', phase: 'play', screen: 'save-slow', inject: 'the rig database (pglite:) holds every query after a confirmed save', recover: 'release: the held save lands, the chip clears', run: 'saveFault' },
  { mode: '30b', id: 'save-slow/blocked', parent: 'save-slow', owner: 'FM8s', phase: 'play', screen: 'save-slow-blocked', inject: 'EXIT TO MAIN while 30 shows (Keep playing, then Leave when saved)', recover: 'release: leaves for the title on the confirmed save', run: 'saveFault' },
  { mode: '31', id: 'save-failed', owner: 'FM8s', phase: 'play', screen: 'save-failed', inject: 'the rig database (pglite:) refuses every connection after a confirmed save', recover: 'Keep playing leaves a warning; pass: the retried save lands, it clears', run: 'saveFault' },
  { mode: '32', id: 'voice-failed', owner: 'FM8', phase: 'play', screen: 'voice-failed', inject: 'two real pages on voice; remote ICE candidates dropped at the page boundary (labelled), empty TURN list', recover: 'Try again: linked', run: 'voice' },
  { mode: '32b', id: 'voice-failed/blocked', parent: 'voice-failed', owner: 'FM8', phase: 'play', screen: 'voice-failed-blocked', inject: 'hold talk (hold mode, desktop page) while 32 shows', recover: 'voice off: the tip goes', run: 'voice' },
  { mode: '33', id: 'packs-5xx', owner: 'FM6', phase: 'load', screen: 'packs-5xx', inject: 'packs status 503 before navigation, healed after 6 s', recover: 'the world loads', run: 'packsFault' },
  { mode: '34', id: 'packs-429', owner: 'FM6', phase: 'load', screen: 'packs-429', inject: 'packs status 429, Retry-After 3, healed after 6 s', recover: 'the world loads', run: 'packsFault' },
  { mode: '35', id: 'book-5xx', owner: 'FM6', phase: 'load', screen: 'book-5xx', inject: 'book status 503 before navigation, healed after 6 s', recover: 'the world loads', run: 'packsFault' },
  { mode: '36', id: 'download-failed', owner: 'FM6', phase: 'load', screen: 'download-failed', inject: 'packs status 503 until the operation refuses', recover: 'heal, Retry: the world loads', run: 'packsFault' },
  { mode: '37', id: 'release-404', owner: 'FM5', phase: 'boot', screen: 'release-404', inject: 'release status 404', recover: 'heal, Try again: the world loads', run: 'releaseFault' },
  { mode: '38', id: 'captive-portal', owner: 'FM5', phase: 'boot', screen: 'captive-portal', inject: 'release body: an HTML sign-in page', recover: 'heal, Try again: the world loads', run: 'releaseFault' },
  { mode: '39', id: 'release-unsigned', owner: 'FM5', phase: 'boot', screen: 'release-unsigned', inject: 'release body: a file with a bad signature', recover: 'heal, Try again: the world loads; no dial while bad', run: 'releaseFault' },
  { mode: '40', id: 'refused', owner: 'FM4', phase: 'play', screen: 'refused', inject: 'socket close 4001 on every connection', recover: 'heal, Play again: seated', run: 'socketDown' },
  { mode: '41', id: 'banned', owner: 'FM8m', phase: 'play', screen: 'banned', inject: 'coded terminal close', recover: 'none: no redial', run: 'banned' },
  { mode: '42', id: 'clock-skew', owner: 'FM4b', phase: 'doctor', screen: 'clock-skew', inject: 'the page clock 2 min ahead, socket refused', recover: 'Run again with the clock right', run: 'clockSkew' },
  { mode: '43', id: 'storage-full', owner: 'FM6', phase: 'load', screen: 'storage-full', inject: 'Cache API put throws QuotaExceededError (labelled injection)', recover: 'plays on from memory', run: 'storageFull' },
  { mode: '44', id: 'pack-broken', owner: 'FM6', phase: 'load', screen: 'packs-5xx', inject: 'packs truncate 64 bytes, healed after 6 s', recover: 'the world loads with verified bytes', run: 'packsFault' },
  { mode: '45', id: 'sleep-wake', owner: 'FM4b', phase: 'play', screen: 'background-long', inject: 'CDP debugger pause 35 s (no timer or clock tick runs) with no visibility change, the live socket cut with it (a sleeping device has no network)', recover: 'seated again: no card', run: 'freeze', chromiumOnly: true },
  { mode: '46', id: 'staging', owner: 'FM5', phase: 'boot', screen: 'staging', inject: 'the fixture release signed with channel staging (loopback only)', recover: 'stays for the session', run: 'staging' },
].map(item => Object.freeze({ ...item, deadlineMs: item.id === 'too-old' ? 600_000 : item.id === 'lost' ? 360_000 : 300_000 })));

/** The cases a `--scenario=` asks for: `all`, or a comma list of ids (a parent id brings its `b` case too). Unknown ids throw. @param {string} asked */
export function selectCases(asked) {
  if (asked === 'all') return [...CASES];
  const ids = asked.split(',').map(word => word.trim()).filter(word => word !== '');
  const unknown = ids.filter(id => !CASES.some(item => item.id === id));
  if (ids.length === 0 || unknown.length > 0) throw new Error(`--scenario names no case: ${unknown.join(', ') || '(empty)'}`);
  return CASES.filter(item => ids.includes(item.id) || (item.parent !== undefined && ids.includes(item.parent)));
}

/** The proof's exit: 0 when every selected case passed; 2 when the harness itself failed (an injection with no match, setup, cleanup or a
 *  guard), whatever else happened; else 1 (a screen missing, a dependency blocked, an engine that can't produce the fault). `--baseline`
 *  collects every case either way; it never changes this verdict. @param {readonly { outcome: Outcome }[]} rows */
export function verdict(rows) {
  if (rows.some(row => row.outcome === 'harness-fail')) return 2;
  return rows.length > 0 && rows.every(row => row.outcome === 'pass') ? 0 : 1;
}

/** Whether a `data-failmode` attribute (space-separated ids) names `id`. @param {string | null} attribute @param {string} id */
export const names = (attribute, id) => attribute !== null && attribute.split(/\s+/u).includes(id);

/** Primary copy a player reads may not carry a raw exception, a status line or an address: those belong in Details. @param {string} text */
export function rawLeak(text) {
  const found = /\b(?:TypeError|Error:|Failed to fetch|NetworkError|undefined|null)\b|https?:\/\/|\bws:\/\/|\b[45]\d\d\b(?!\s*ms)/u.exec(text);
  return found === null ? null : found[0];
}
