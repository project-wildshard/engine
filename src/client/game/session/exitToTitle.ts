import { leaveSaved, markUnload } from '@wildshard/engine/boot/lastEnd';
import { leftByPlayer } from '@wildshard/engine/boot/dropNotice';

interface TitleNavigation {
  readonly url: string;
  replace: (url: string) => void;
}

function browserNavigation(): TitleNavigation { return {
  url: location.href,
  replace: url => { markUnload('exit to main menu (fresh page)'); location.replace(url); },
}; }

/** The document owns the world. Leave as soon as a held server's last save lands; the browser releases the rest.
 * No disposal chain or worker handover may gate the replacement title. */
export function exitSessionToTitle(navigation: TitleNavigation = browserNavigation()): void {
  // the player's own exit: the title it reaches shows no drop modal (src/client/engine/boot/dropNotice.ts)
  leaveSaved(() => { leftByPlayer(); navigation.replace(new URL('/', navigation.url).href); });
}
