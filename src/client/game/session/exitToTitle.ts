import { leaveSaved, markUnload } from '@wildshard/engine/boot/lastEnd';
import { leftByPlayer } from '@wildshard/engine/boot/dropNotice';
import { replaceFresh } from '@wildshard/engine/boot/freshPage';
import { dropOwnArrival } from '@wildshard/engine/boot/titleArrival';

interface TitleNavigation {
  readonly url: string;
  replace: (url: string) => void;
}

function browserNavigation(): TitleNavigation { return {
  url: location.href,
  replace: url => { markUnload('exit to main menu (fresh page)'); replaceFresh(url); },
}; }

/** The document owns the world. Leave as soon as a held server's last save lands; the browser releases the rest.
 * No disposal chain or worker handover may gate the replacement title. */
export function exitSessionToTitle(navigation: TitleNavigation = browserNavigation()): void {
  // the player's own exit: the title it reaches shows no drop modal (src/client/engine/boot/dropNotice.ts)
  // QA 11-25 row 90: and no tap: a bare `/` adopts a fresh one (CP1), and a travel's left behind re-entered its zone
  leaveSaved(() => { leftByPlayer(); dropOwnArrival(); navigation.replace(new URL('/', navigation.url).href); });
}
