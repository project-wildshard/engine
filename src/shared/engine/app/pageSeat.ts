import type { App } from '../../../client/engine/app/app';

/**
 * The page's one app, for an owner on the server side that still runs on the page (E6: port first, flip last). `client/app/runtime`
 * seats it when it loads; a headless host never does, so reading it there refuses. The flip deletes this seat with its readers.
 */
let seated: App | null = null;
export function seatPageApp(app: App): void { seated = app; }
export function pageApp(): App {
  if (seated === null) throw new Error('No page app is seated');
  return seated;
}
