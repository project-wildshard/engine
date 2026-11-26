/**
 * Meta IPHONE13-DRIFTWOOD DW12 (mini-dw12e): a navigation the game chooses that boots the game again (a shard switch, a
 * reload, the title) leaves through the leave page (`/leave?to=<path>`, src/scripts/app-build/isolation.mjs LEAVE_PAGE). The
 * game's document says COOP `same-origin` and the leave page says none, so WebKit starts the next game document in a new
 * WebContent. Without it the next boot runs in the process that held the last world, and on the iPhone 13 that warm boot
 * was jetsammed at the 1536 MB limit every time (direct return 2 of 2 and 4 of 4) while one through a COOP-less page
 * held (3 of 3). The Vite dev server has no leave page, so a dev build goes straight there.
 */

/** The leave page's path (pages/worker.ts, src/scripts/preview-server.mjs and the service worker answer it). */
export const LEAVE_PATH = '/leave';

/** The address that reaches `target` through the leave page; another origin's address is itself. */
export function throughLeave(target: string | URL, origin: string): string {
  const url = new URL(target, origin);
  if (url.origin !== origin) return url.href;
  return `${LEAVE_PATH}?to=${encodeURIComponent(`${url.pathname}${url.search}${url.hash}`)}`;
}

/** Replace this page with a fresh game page at `target` (a new WebContent), keeping one history entry. */
export function replaceFresh(target: string | URL): void {
  location.replace(import.meta.env.DEV ? new URL(target, location.href).href : throughLeave(new URL(target, location.href), location.origin));
}

/** `location.reload()` in a fresh WebContent: this address again, through the leave page. */
export function reloadFresh(): void { replaceFresh(location.href); }
