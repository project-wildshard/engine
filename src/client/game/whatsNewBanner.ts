import * as v from 'valibot';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { GAME_STRINGS } from '../../shared/game/strings';
import type { WhatsNew } from './whatsNew';
/**
 * The main menu's WHAT'S NEW banner (SHARD-PLATFORM SF60, Jake's pick G214: B, a slim banner under the logo;
 * `art/menu/round-12-whats-new/B-banner.jpg` folded, `B-banner-open.jpg` open). Folded it is one line under the
 * WILDSHARD logo: WHAT'S NEW, the engine version and short commit ("V0.1.5 · A8144A5", Jake 2026-11-10) and a ▾; a tap drops
 * a panel under it with the engine line, that version's changelog (src/client/game/whatsNew.ts, CHANGELOG.md) and HIDE UNTIL
 * NEXT BUILD, which stores the build it was hidden on in a device save and brings the banner back when the running build
 * changes. It shows only with Settings ▸ Developer on (E451: Developer is Jake's view of the unfinished work) and with at least
 * one entry. Menu DOM only: no per-frame work, text via textContent.
 *
 *   const banner = buildWhatsNewBanner({ news: WHATS_NEW, developer: isDev(), onTap: deck.onTap });   // null when it doesn't show
 */
declare const __BUILD_ID__: string; // vite.config.ts define; absent under Node

/** the running build's id (`<sha>-<stamp>`), '' under a unit test */
export function runningBuild(): string { return typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : ''; }

/** `<sha>-<stamp>` → the 7-character commit (the stamp when a build has no git checkout), the build pill's rule
 *  (src/client/engine/ui/buildCheck.ts). A world build's id is the full commit; Jake 2026-11-10: "show the short commit, not
 *  this long ass thing". One commit rebuilt keeps one id, so a redeploy of the same build stays hidden */
export function shortBuild(id: string): string {
  const [sha = '', stamp = ''] = id.split('-');
  return /^[0-9a-f]{7,40}$/iu.test(sha) ? sha.slice(0, 7) : sha.length >= 7 ? sha : stamp;
}

/** The build's `git describe` ("v0.1.13-100-g5a43d1c4", Jake 2026-11-12), else "v0.1.5 · a8144a5": the engine version
 *  and the short commit, either alone when the other is unknown */
export function versionLabel(version: string, build: string, describe = ''): string {
  if (describe !== '') return describe;
  return [version === '' ? '' : `v${version}`, build].filter(part => part !== '').join(' · ');
}

/** "2026-11-10" → "10 NOV 2026", as the engine line shows the version's date ('' stays '') */
export function changelogDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  const month = m === null ? undefined : ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(m[2]) - 1];
  return m === null || month === undefined ? '' : `${String(Number(m[3]))} ${month} ${m[1] ?? ''}`;
}

/** where HIDE UNTIL NEXT BUILD remembers the build it was pressed on */
export interface HiddenStore { readonly read: () => string | null; readonly write: (build: string) => void }

/** the per-device save (try/catch: a private window or full storage just shows the banner again) */
export function deviceHiddenStore(): HiddenStore {
  const slot = (): ReturnType<typeof jsonSlot> => jsonSlot('menu.whatsNew.hiddenOn', 'device', () => null, v.nullable(v.string()));
  return {
    read: () => { try { const value = slot().read(); return typeof value === 'string' ? value : null; } catch { return null; } },
    write: (build) => { try { slot().write(build); } catch { /* storage unavailable: hidden for this page only */ } },
  };
}

/** the gate: Developer on, at least one entry, and not hidden on this build */
export function whatsNewShown(opts: { readonly developer: boolean; readonly entries: number; readonly build: string; readonly hiddenOn: string | null }): boolean {
  return opts.developer && opts.entries > 0 && opts.hiddenOn !== opts.build;
}

export interface WhatsNewBannerOptions {
  readonly news: WhatsNew;
  /** Settings ▸ Developer, read when the menu builds (flipping it rebuilds the menu) */
  readonly developer: boolean;
  /** the running build (default: `shortBuild(runningBuild())`) */
  readonly build?: string;
  readonly store?: HiddenStore;
  /** the menu's tap wiring (the deck's scope owns the listeners) */
  readonly onTap: (el: HTMLElement, fn: () => void) => void;
}

export interface WhatsNewBanner {
  readonly root: HTMLElement;
  readonly open: boolean;
  readonly toggle: () => void;
  /** HIDE UNTIL NEXT BUILD: stores the build and removes the banner */
  readonly hide: () => void;
}

/** the banner, or null when the gate says it doesn't show */
export function buildWhatsNewBanner(opts: WhatsNewBannerOptions): WhatsNewBanner | null {
  const store = opts.store ?? deviceHiddenStore();
  const build = opts.build ?? shortBuild(runningBuild());
  const { entries, date, version, describe } = opts.news;
  const label = versionLabel(version, build, describe).toUpperCase();
  let hiddenOn: string | null = null;
  try { hiddenOn = store.read(); } catch { /* unreadable: show it */ }
  if (!whatsNewShown({ developer: opts.developer, entries: entries.length, build, hiddenOn })) return null;
  const s = GAME_STRINGS.mainMenu.whatsNew;
  const { onTap } = opts;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const root = el('section', 'ws-whatsnew');
  root.setAttribute('aria-label', s.label);
  const head = el('button', 'ws-whatsnew-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.append(el('i', 'ws-whatsnew-dot'), el('span', 'ws-whatsnew-title', s.title), el('span', 'ws-whatsnew-build', label), el('span', 'ws-whatsnew-caret'));
  const body = el('div', 'ws-whatsnew-body');
  body.id = 'ws-whatsnew-body';
  body.hidden = true;
  head.setAttribute('aria-controls', body.id);
  const list = el('ul', 'ws-whatsnew-list');
  for (const entry of entries) list.append(el('li', '', entry));
  const hideBtn = el('button', 'ws-whatsnew-hide', s.hide);
  hideBtn.type = 'button';
  body.append(el('div', 'ws-whatsnew-line', s.buildLine(label, changelogDate(date))), list, hideBtn);
  root.append(head, body);

  let open = false;
  const toggle = (): void => {
    open = !open;
    root.classList.toggle('open', open);
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  };
  const hide = (): void => { try { store.write(build); } catch { /* unwritable: hidden for this page only */ } root.remove(); };
  onTap(head, toggle);
  onTap(hideBtn, hide);
  return { root, get open() { return open; }, toggle, hide };
}
