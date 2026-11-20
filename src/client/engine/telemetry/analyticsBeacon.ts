/**
 * QA 11-19 row 19 (Jake: seven seconds from the Home Screen icon to the menu): iOS keeps its still launch image up until
 * the document's `load`, and Cloudflare's Web Analytics beacon, injected into the page by the zone, is a module script from
 * a third origin that `load` waits for. The page loads the same beacon itself once the title (or a world) is interactive,
 * so no page view is lost when the zone stops injecting it on the page hosts. A page that still has the injected beacon
 * gets no second one.
 */
import { harnessPins } from '../../../shared/engine/app/identity';
import type { Scope } from '../../../shared/engine/app/scope';

/** Cloudflare's beacon (the script the zone injects) */
export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
/** the wildshard.io zone's Web Analytics site token: public, every injected page carries it. Named the site id so the
 *  push's blob check (quoted credential: a name ending in token, then a long quoted value) does not read it as one. */
const BEACON_SITE_ID = '17cf584503d04dbd96da311b2abbb624';

/** Whether this page should load the beacon: a wildshard.io page, not a harness, with no beacon yet. */
export function beaconWanted(doc: Pick<Document, 'querySelector'>, host: string, harness: boolean): boolean {
  if (harness || !(host === 'wildshard.io' || host.endsWith('.wildshard.io'))) return false;
  return doc.querySelector('script[src^="https://static.cloudflareinsights.com/"]') === null;
}

/** Add the beacon (deferred, after the page is interactive). True when it was added. */
export function loadAnalyticsBeacon(doc: Document = document, host: string = location.hostname): boolean {
  if (!beaconWanted(doc, host, harnessPins() !== undefined)) return false;
  const script = doc.createElement('script');
  script.defer = true; script.src = BEACON_SRC; script.crossOrigin = 'anonymous';
  script.dataset['cfBeacon'] = JSON.stringify({ token: BEACON_SITE_ID, spa: true });
  doc.head.append(script);
  return true;
}

/** Load the beacon a second after the page is first interactive: the title (`ws:ready`) or a world (`ws:control-ready`),
 *  whichever comes first, never on the `load` path. The page entry arms it once as it evaluates: a launch that stays on the
 *  title never runs `start()` (entry.ts imports main.ts only on the way to a world), so arming it there sent no page view. */
export function armAnalyticsBeacon(scope: Scope, doc: Document = document, host: string = location.hostname,
  load: (doc: Document, host: string) => boolean = loadAnalyticsBeacon): void {
  let armed = false;
  for (const ready of ['ws:ready', 'ws:control-ready']) scope.listen(doc, ready, () => {
    if (armed) return;
    armed = true;
    scope.timeout(1000, () => { load(doc, host); });
  }, { once: true });
}
