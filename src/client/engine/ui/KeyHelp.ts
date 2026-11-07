import { app } from '../app/runtime';
import { listenPage } from '../input/dom';
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';
import { BindingTable } from '../input/bindingTable';
import { keycap } from '../input/keycap';
import { mountUi } from './ownership';

const div = (cls: string, text = ''): HTMLDivElement => { const d = document.createElement('div'); d.className = cls; if (text !== '') d.textContent = text; return d; };

/**
 * Quick key help (E419, Jake: "a quick help button for all shards to show key bindings"): during play the `help` action
 * (F1 or /, rebindable under Settings ▸ Key bindings ▸ Menus) opens a read-only card of the live key bindings. It reads
 * the same table as Settings ▸ Key bindings, so a level's own rows (a shard's verb, a ride's keys) show while that level
 * is loaded, and custom keys show as the player set them. Desktop only (a fine pointer: touch has its buttons on
 * screen). Esc, the help key again or a click closes it; it opens over play only, never over another menu.
 */
export function installKeyHelp(scope: Scope): void {
  const desktop = window.matchMedia('(pointer: fine)');
  let open: Scope | null = null;
  const close = (): void => { open?.dispose(); open = null; };
  // F1 opens the browser's own help page unless the game takes it
  listenPage(scope, 'keydown', (e: KeyboardEvent) => { if (e.code === 'F1') e.preventDefault(); });
  const show = (): void => {
    if (open !== null) { close(); return; }
    if (!desktop.matches || app.state !== 'play' || app.ui.blocking) return;
    const s = scope.child('keyHelp'); open = s;
    const root = div('ws-gmenu-keyhelp'), card = div('ws-gmenu-keyhelp-card');
    card.append(div('ws-gmenu-keyhelp-title', engineString('s_keyhelp_title')));
    const cols = div('ws-gmenu-keyhelp-cols'), table = new BindingTable(app.input.bindings);
    for (const group of table.groups()) {
      const col = div('ws-gmenu-keyhelp-group');
      col.append(div('ws-gmenu-keyhelp-grouptitle', group.def.label));
      for (const row of group.rows) {
        const keys = row.def.chips === true
          ? row.cells.map((_, i) => table.key(row, i)).filter((k): k is string => k !== undefined)
          : [0, 1].map((i) => table.key(row, i)).filter((k): k is string => k !== undefined);
        if (keys.length === 0) continue;
        const line = div('ws-gmenu-keyhelp-row');
        line.append(div('ws-gmenu-keyhelp-label', row.def.label));
        const caps = div('ws-gmenu-keyhelp-keys');
        for (const key of keys) caps.append(div('ws-gmenu-keyhelp-cap', keycap(key)));
        line.append(caps); col.append(line);
      }
      cols.append(col);
    }
    card.append(cols, div('ws-gmenu-keyhelp-foot', engineString('s_keyhelp_foot')));
    root.append(card); mountUi(root, s, document.body);
    app.ui.push('modal', { root, back: close }, s);
    s.listen(root, 'pointerdown', close);
    // the key that opened it reaches this listener too: it arms on that key's release, so only a later press closes it
    let armed = false;
    listenPage(s, 'keyup', () => { armed = true; });
    listenPage(s, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' || (armed && (e.code === 'F1' || e.code === 'Slash'))) { e.preventDefault(); close(); }
    });
  };
  app.input.bind('help', show, scope);
}
