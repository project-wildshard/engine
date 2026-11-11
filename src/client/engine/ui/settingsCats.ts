import { listenTap } from '../input/dom';
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';

export const SETTINGS_CATS = ['video', 'audio', 'controls', 'keys', 'gameplay', 'save', 'review', 'debug'] as const;
export type SettingsCat = typeof SETTINGS_CATS[number];
/** Two panes need a keyboard-and-mouse desktop with room for a rail: a narrow window keeps the phone's one column. */
export const SETTINGS_DESK_QUERY = '(pointer: fine) and (min-width: 900px)';

export interface SettingsCats {
  /** where the Settings cards go: the right pane on a desktop, the panel itself (display: contents) on a phone */
  readonly pane: HTMLElement;
  /** files elements under a category; `head` marks a section label that only repeats the category's own name */
  tag: (cat: SettingsCat, ...els: HTMLElement[]) => void;
  head: (el: HTMLElement) => HTMLElement;
  select: (cat: SettingsCat) => void;
  /** re-reads which categories have anything to show (a gated row, developer mode) and the device */
  sync: () => void;
  readonly desk: boolean;
  readonly selected: SettingsCat;
}

/** pause ▸ Settings as layout A (J10): a category rail on the left, one category on the right. A phone keeps the
 *  single scrolling column it had: every category stacked in the same order, the rail and Video left out. */
export function settingsCategories(panel: HTMLElement, scope: Scope, labels: Record<SettingsCat, string>, changed: () => void): SettingsCats {
  const media = window.matchMedia(SETTINGS_DESK_QUERY);
  const rail = document.createElement('nav'); rail.className = 'ws-gmenu-rail';
  const pane = document.createElement('div'); pane.className = 'ws-gmenu-pane'; pane.dataset['scroll'] = '';
  const title = document.createElement('div'); title.className = 'ws-gmenu-cathead';
  pane.append(title); panel.append(rail, pane);
  const tagged: { cat: SettingsCat; el: HTMLElement }[] = [];
  const buttons = new Map<SettingsCat, HTMLButtonElement>();
  let selected: SettingsCat = 'video';
  const shown = (el: HTMLElement): boolean => el.hidden === false;
  const shows = (cat: SettingsCat): boolean => tagged.some((t) => t.cat === cat && shown(t.el));
  const api: SettingsCats = {
    pane,
    tag: (cat, ...els) => { for (const el of els) { el.dataset['cat'] = cat; tagged.push({ cat, el }); } },
    head: (el) => { el.classList.add('catdup'); return el; },
    select: (cat) => { selected = cat; api.sync(); },
    sync: () => {
      // QA 49: a tabbed Settings layout (settingsTabs.ts) has taken the rows: no rail, nothing folded away by category
      if (panel.classList.contains('ws-gmenu-svon')) { panel.classList.remove('cats'); for (const { el } of tagged) el.classList.remove('catoff'); changed(); return; }
      const desk = media.matches;
      if (desk && !shows(selected)) selected = SETTINGS_CATS.find(shows) ?? selected;
      panel.classList.toggle('cats', desk);
      for (const [cat, b] of buttons) { b.hidden = !shows(cat); b.classList.toggle('active', cat === selected); b.setAttribute('aria-current', String(cat === selected)); }
      for (const { cat, el } of tagged) el.classList.toggle('catoff', desk ? cat !== selected : cat === 'video');
      // a card with nothing of this category left in it goes too (Settings holds four categories' rows)
      for (const child of pane.children) {
        if (!(child instanceof HTMLElement) || child === title || child.dataset['cat'] !== undefined) continue;
        child.classList.toggle('catoff', !tagged.some(({ el }) => child.contains(el) && shown(el) && !el.classList.contains('catoff')));
      }
      title.textContent = labels[selected];
      changed();
    },
    get desk() { return media.matches; },
    get selected() { return selected; },
  };
  for (const cat of SETTINGS_CATS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ws-gmenu-cat'; b.textContent = labels[cat]; b.dataset['cat'] = cat;
    listenTap(scope, b, () => { api.select(cat); });
    buttons.set(cat, b); rail.append(b);
  }
  scope.listen(media, 'change', () => { api.sync(); });
  return api;
}
export const settingsHint = (): string => engineString('s_settings_hint_desk');
