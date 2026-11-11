import { app } from '@wildshard/engine/app/runtime';
import type { Action } from '@wildshard/engine/input/InputService';

type Scope = Parameters<typeof app.input.bindings.describe>[1];
type Table = Parameters<typeof app.input.bindings.describe>[0];
const row = (group: string, id: string, label: string, actions: readonly Action[], extra: { chips?: boolean; shares?: readonly string[] } = {}) => ({ group, id, label, actions, ...extra });

/** pause ▸ Settings ▸ Key bindings (E357 J10, Jake's layout A): plain action names in five groups over two columns. A row
 *  writes every context that binds its actions with the same default key; a group with no registered context hides. */
export const KEY_BINDINGS: Table = {
  groups: [
    { id: 'foot', label: 'On foot', column: 0 }, { id: 'swim', label: 'Swimming', column: 0 },
    { id: 'combat', label: 'Combat', column: 1 }, { id: 'riding', label: 'Riding', column: 1 }, { id: 'menus', label: 'Menus', column: 1 },
  ],
  rows: [
    row('foot', 'forward', 'Move forward', ['move.forward']), row('foot', 'back', 'Move back', ['move.back']),
    row('foot', 'left', 'Move left', ['move.left', 'lean.left']), row('foot', 'right', 'Move right', ['move.right', 'lean.right']),
    row('foot', 'jump', 'Jump', ['jump']), row('foot', 'sprint', 'Sprint', ['sprint']), row('foot', 'crouch', 'Crouch', ['crouch']),
    row('foot', 'dodge', 'Dodge', ['dodge']), row('foot', 'use', 'Interact', ['use']), row('foot', 'hover', 'Hoverboard', ['hover']),
    // swimming blocks jump and sprint (inputContexts swim.blocks), so Space and Shift serve both
    row('swim', 'dive', 'Dive', ['dive'], { shares: ['jump'] }), row('swim', 'surface', 'Surface', ['surface'], { shares: ['sprint'] }),
    row('combat', 'attack', 'Attack', ['attack']), row('combat', 'heavy', 'Heavy / Aim', ['heavy', 'aim']), row('combat', 'lock', 'Lock on', ['lock']),
    row('combat', 'reload', 'Reload', ['reload']), row('combat', 'swap', 'Swap weapon', ['swap']),
    // one row for the first four slots; 5–9 stay bound behind it
    row('combat', 'slots', 'Weapon 1–4', ['swap.slot.1', 'swap.slot.2', 'swap.slot.3', 'swap.slot.4'], { chips: true }),
    row('menus', 'pause', 'Pause', ['pause']), row('menus', 'bag', 'Bag', ['bag']), row('menus', 'map', 'Map', ['map']),
    row('menus', 'journal', 'Journal', ['journal']), row('menus', 'quickNote', 'Quick note', ['quickNote']),
    // the quick key help (E419, src/client/engine/ui/KeyHelp.ts)
    row('menus', 'help', 'Key help', ['help']),
  ],
};
/** VOICE-POLISH V10: voice chat's talk key, in a build of the online world only (single player has no voice). */
export const VOICE_BINDINGS: Table = { groups: [{ id: 'voice', label: 'Voice chat', column: 0 }], rows: [row('voice', 'talk', 'Talk', ['voice.talk'])] };
export function describeKeyBindings(scope: Scope): void {
  app.input.bindings.describe(KEY_BINDINGS, scope);
  if ((globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__ !== undefined) app.input.bindings.describe(VOICE_BINDINGS, scope);
}
