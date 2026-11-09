import { app } from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
import type { Scope } from '../../../shared/engine/app/scope';
import { keyPlatform } from './platform';
import { BindingTable, bindableKey, keyOfCode, type BindingTableRow } from './bindingTable';

import { keycap, shortcut } from './keycap';

const div = (cls: string, text = ''): HTMLDivElement => { const d = document.createElement('div'); d.className = cls; if (text !== '') d.textContent = text; return d; };
interface Editing { row: string; cell: number; key?: string; clash?: { row: string; cell: number } }

/** Settings ▸ Key bindings (desktop only, J10 layout A): a dense ACTION / KEY / ALT table in plain-named groups over two
 *  columns. Clicking a key captures the next key or mouse button on it; a clash asks before it swaps. */
export function buildControlsPanel(parent: Scope): HTMLDivElement & { refresh: () => void } {
  const scope = parent.child('controls'), input = app.input, table = new BindingTable(input.bindings);
  // Primary fine-pointer mode includes laptops with touchscreens, but excludes touch-only
  // devices even when their browser requests a desktop site. Viewport size is not a keyboard.
  const desktop = window.matchMedia('(pointer: fine)');
  const card = div('ws-gmenu-card ws-gmenu-keys');
  const title = div('ws-gmenu-cardtitle', engineString('s_f4fce9bc331d'));
  const note = div('ws-gmenu-note', engineString('s_keys_hint'));
  // KP5: what the browser's own shortcuts do in play, in this platform's words (⌘W on a Mac, Ctrl+W elsewhere; ⌘Q is a
  // Mac's quit, Alt+F4 the others' close-window); src/client/engine/ui/leaveGuard.ts and HUD.ts's blur pause
  const browser = div('ws-gmenu-note ws-gmenu-keybrowser', engineString('s_keys_browser', [shortcut('W'), keyPlatform() === 'mac' ? shortcut('Q') : 'Alt+F4', shortcut('T'), shortcut('N')]));
  const cols = div('ws-gmenu-keycols');
  const clash = div('ws-gmenu-keyclash'); clash.setAttribute('role', 'status');
  const foot = div('ws-gmenu-keyfoot');
  const cells = new Map<string, HTMLButtonElement>();
  let editing: Editing | null = null, capture: Scope | null = null, rows = scope.child('rows'), swallow: HTMLElement | null = null;
  const button = (cls: string, text: string, run: () => void, owner: Scope): HTMLButtonElement => {
    const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; owner.listen(b, 'click', run); return b;
  };
  const rowOf = (id: string): BindingTableRow | undefined => table.rows().find((row) => row.def.id === id);
  const cancel = (): void => { capture?.dispose(); capture = null; editing = null; };
  /** cell text and marks from the table and the edit in flight; the buttons stay (a click mid-capture still lands) */
  const paint = (): void => {
    for (const [id, b] of cells) {
      const [rowId = '', at = '0'] = id.split('|'), cell = Number(at), row = rowOf(rowId);
      const own = editing?.row === rowId && editing.cell === cell, held = editing?.clash?.row === rowId && editing.clash.cell === cell;
      const key = own && editing?.key !== undefined ? editing.key : row === undefined ? undefined : table.key(row, cell);
      b.textContent = own && editing?.key === undefined ? engineString('s_8f54cf405740') : key === undefined ? engineString('s_keys_none') : keycap(key);
      b.classList.toggle('empty', key === undefined && !own); b.classList.toggle('pending', own); b.classList.toggle('clash', held);
    }
    clash.replaceChildren(); clash.hidden = editing?.clash === undefined && editing?.key === undefined;
  };
  const apply = (key: string | undefined): void => {
    const edit = editing, row = edit === null ? undefined : rowOf(edit.row);
    if (edit === null || row === undefined) return;
    const held = table.assign(row, edit.cell, key);
    if (held === undefined) { cancel(); refresh(); return; }
    capture?.dispose(); capture = scope.child('clash');
    editing = { ...edit, ...(key === undefined ? {} : { key }), ...(held.row === undefined || held.cell === undefined ? {} : { clash: { row: held.row.def.id, cell: held.cell } }) };
    paint();
    clash.append(div('ws-gmenu-keyclashtext', engineString('s_632fe896901d', [held.label])),
      button('ws-gmenu-keybtn', engineString('s_4e7f483dadbe'), () => { table.assign(row, edit.cell, key, true); cancel(); refresh(); }, capture),
      button('ws-gmenu-keybtn', engineString('s_8097ea62e33b'), () => { cancel(); paint(); }, capture));
  };
  const arm = (owner: Scope): void => {
    input.captureNextKey((code) => {
      const edit = editing; if (edit === null) return;
      if (code === 'Escape') { cancel(); paint(); return; }
      const alt = (rowOf(edit.row)?.cells.length ?? 0) === 2 && edit.cell === 1;
      if (code === 'Backspace' || code === 'Delete') { if (alt) apply(undefined); else arm(owner); return; }
      if (!bindableKey(code)) { arm(owner); return; }
      apply(keyOfCode(code));
    }, owner);
  };
  const edit = (row: string, cell: number, b: HTMLButtonElement): void => {
    if (swallow === b) { swallow = null; return; }
    cancel(); editing = { row, cell }; const owner = scope.child('capture'); capture = owner; paint(); arm(owner);
    // a mouse button pressed on the waiting cell binds it; a press anywhere else gives up
    owner.listen(document, 'mousedown', (event) => {
      if (!(event instanceof MouseEvent)) return;
      if (event.target !== b) { cancel(); paint(); return; }
      event.preventDefault(); swallow = event.button === 0 ? b : null; apply(`Mouse${event.button}`);
    }, { capture: true });
    owner.listen(b, 'contextmenu', (event) => { event.preventDefault(); });
  };
  function refresh(): void {
    card.hidden = !desktop.matches; card.inert = card.hidden;
    if (card.hidden) { cancel(); return; }
    rows.dispose(); rows = scope.child('rows'); cols.replaceChildren(); cells.clear();
    const groups = table.groups();
    for (const column of [0, 1] as const) {
      const box = div('ws-gmenu-keycol');
      box.append(div('ws-gmenu-keyhead', engineString('s_keys_action')), div('ws-gmenu-keyhead', engineString('s_keys_key')), div('ws-gmenu-keyhead', engineString('s_keys_alt')));
      for (const group of groups.filter((g) => g.def.column === column)) {
        box.append(div('ws-gmenu-keygroup', group.def.label));
        for (const row of group.rows) {
          const keys = div(row.def.chips === true ? 'ws-gmenu-keychips' : 'ws-gmenu-keypair');
          row.cells.forEach((_, cell) => {
            const b = button('ws-gmenu-keycap', '', () => { edit(row.def.id, cell, b); }, rows);
            b.dataset['row'] = row.def.id; b.dataset['cell'] = String(cell);
            cells.set(`${row.def.id}|${cell}`, b); keys.append(b);
          });
          box.append(div('ws-gmenu-keyname', row.def.label), keys);
        }
      }
      if (box.childElementCount > 3) cols.append(box);
    }
    paint();
  }
  foot.append(button('ws-gmenu-keybtn', engineString('s_dd7d08f05555'), () => { cancel(); table.reset(); refresh(); }, scope));
  card.append(title, note, browser, cols, clash, foot);
  scope.listen(desktop, 'change', refresh);
  scope.onDispose(() => { capture?.dispose(); card.remove(); }); refresh();
  return Object.assign(card, { refresh });
}
