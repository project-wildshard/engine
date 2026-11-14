/** OFFLINE OF9 (J298, Jake 2026-11-12: "Load into the world. And then have a really hard time moving around"): how long a world
 *  build's load waits for its seat before it opens the world without one. A seat in time keeps QA row 29's reveal at the saved place;
 *  a page that knows it is offline doesn't wait at all. */
export const SEAT_GRACE_MS = 1500;
/** OF9: whether the seat comes within `graceMs` (the page's link known down: no wait). A pure race, so a test pins it. */
export function seatedInTime(booted: Promise<unknown>, graceMs: number, online: boolean, wait: (ms: number) => Promise<void>): Promise<boolean> {
  if (!online) return Promise.resolve(false);
  return Promise.race([booted.then(() => true, () => true), wait(graceMs).then(() => false)]);
}
