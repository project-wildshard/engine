/**
 * The loading screen's markup, painted from the first HTML bytes (project/archive/2026-09-22-load-perf.md §1b, the
 * gauntlet's `inline.ts` idea): index.html carries this exact markup inside `<div class="ws-load"
 * data-shell>`, so the title panel is on screen as soon as the page's CSS is — before the 1.7 MB bundle
 * has downloaded, compiled and run. `Loading` (src/client/engine/ui/Loading.ts) adopts that element and fills in the
 * two facts only the bundle knows (`slug`, `tier`); a page without the shell (dev harnesses) builds it
 * from this same markup. test/shell.test.ts keeps index.html and this markup identical; the wordmark and tagline are the
 * app's (src/shared/engine/app/identity.ts).
 */
import type { Scope } from '../../../shared/engine/app/scope';
import { HudSlots } from '../ui/hudSlots';
import { appIdentity } from '../../../shared/engine/app/identity';
import { beginLoadingWait, finishLoadingWait } from '../../../shared/engine/boot/loadingWaits';
import { arrivalCard } from './titleArrival';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { engineString } from '../../../shared/engine/strings';

const shellHtml = (tagline: string): string => `<div class="ws-load-head">
<div class="ws-wordmark">${appIdentity().wordmark}</div>
<div class="ws-load-tagline">${tagline}</div>
</div>
<div class="ws-load-body">
<div class="ws-glass ws-load-panel">
<div class="ws-load-title"><span class="ws-load-kicker" data-el="kicker">Loading</span><b data-el="slug"></b><span class="ws-load-clock" data-el="clock">00:00.0</span></div>
<div class="ws-load-meta ws-load-meta-1">
<div><span>tier</span><span data-el="tier"></span></div>
</div>
<div class="ws-load-phase" data-phase="start" data-state="on" data-open>
<button type="button" class="ws-load-track-row" data-el="stHead"><span class="ws-load-track-name">start</span><span class="ws-load-track-fact" data-el="stFact">—</span><span class="ws-load-track-pct" data-el="stPct">—</span></button>
<div class="ws-load-bar"><div class="ws-load-fill" data-el="stBar" data-phase-bar="start"></div></div>
<div class="ws-load-log" data-el="stRows"></div>
</div>
<div class="ws-load-phase" data-phase="download">
<button type="button" class="ws-load-track-row" data-el="dlHead"><span class="ws-load-track-name">download</span><span class="ws-load-track-fact" data-el="dlFact">—</span><span class="ws-load-track-pct" data-el="dlPct">—</span></button>
<div class="ws-load-bar"><div class="ws-load-fill" data-el="dlBar" data-phase-bar="download"></div></div>
<div class="ws-load-log" data-el="dlRows"></div>
<div class="ws-load-track-row ws-load-grid" data-el="pfRow" hidden><span class="ws-load-track-name">grid</span><span class="ws-load-track-fact" data-el="pfFact">—</span><span class="ws-load-track-pct" data-el="pfPct">0</span></div>
</div>
<div class="ws-load-phase" data-phase="load">
<button type="button" class="ws-load-track-row" data-el="suHead"><span class="ws-load-track-name">load</span><span class="ws-load-track-fact" data-el="suFact">—</span><span class="ws-load-track-pct" data-el="suPct">0</span></button>
<div class="ws-load-bar"><div class="ws-load-fill" data-el="suBar" data-phase-bar="load"></div></div>
<div class="ws-load-log" data-el="suRows"></div>
</div>
</div>
</div>
<div class="ws-load-foot"><span data-el="foot"></span><button type="button" class="ws-load-retry" data-el="retry" hidden>Retry</button></div>`;

/** LS2: Start's named LS1 boundaries, in order, from the document to the game's code adopting the card. index.html's
 * data-loading-clock script counts the same operations (test/loading-card.test.ts keeps the two lists equal): Start's bar
 * moves only when one of them completes, never on time. */
export const START_STEPS: readonly (readonly [operation: string, label: string])[] = [
  ['app:document-and-module-graph', 'Code'], ['app:page-entry-import', 'Entry'], ['app:tables-import-and-prepare', 'Tables'],
  ['app:tier-menu-download-imports', 'Tier and menu'], ['app:three-import', 'Renderer'], ['app:main-import', 'Game code'],
  ['app:selected-discovery', 'World choice'],
];

/** Runtime shell markup: the caller fills the identity tagline through textContent. */
export const loadShellTemplate = (): string => shellHtml('');

/** Keep first-document progress alive until its nonblocking startup styles load.
 * Existing sheets need no await; load/error and retirement keep their native meaning. */
export async function waitForLoadingStyles(owner: Scope): Promise<void> {
  if (owner.disposed || owner.disposing) throw new Error('Loading styles require a live owner');
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][media="print"]')]
    .filter(link => !link.disabled && link.sheet === null);
  if (links.length === 0) return;
  const scope = owner.child('loading.styles'), waits: number[] = [];
  try {
    await Promise.all(links.map(link => new Promise<void>((resolve, reject) => {
      const id = beginLoadingWait('Stylesheet download', { kind: 'file', resource: link.href }); waits.push(id);
      const loaded = (): void => { finishLoadingWait(id); resolve(); };
      scope.listen(link, 'load', loaded);
      scope.listen(link, 'error', () => { reject(new Error(`Stylesheet failed: ${link.href}`)); });
      scope.onDispose(() => { reject(new DOMException('Stylesheet wait retired', 'AbortError')); });
      if (link.sheet !== null) loaded();
    })));
  } finally {
    for (const id of waits) finishLoadingWait(id);
    scope.dispose();
  }
}

/** DL21 (E526): until `Loading` adopts the static card (`stopShellClock`), it runs on its own: a clock from the title tap
 * (the fresh title arrival's time, else the document's start), handed to `Loading` as `clockStartedAt`; the shard's name
 * and tier from that arrival; and the code wait named. The first painted card is never a frozen zero. */
let shellClock: Scope | undefined;
const clockText = (ms: number): string => {
  const seconds = Math.max(0, ms) / 1000;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
};
export function startShellClock(owner: Scope, slug: string): void {
  const root = document.querySelector<HTMLElement>('.ws-load[data-shell]');
  if (root === null || shellClock !== undefined) return;
  // index.html's data-loading-clock script may already run this clock from the first paint: then it keeps it.
  const inline = root.dataset['clockStartedAt'] !== undefined;
  const arrival = arrivalCard(slug), started = arrival === null ? 0 : Math.min(0, Math.max(-60_000, arrival.at - performance.timeOrigin));
  if (!inline) root.dataset['clockStartedAt'] = String(started);
  const field = (name: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-el="${name}"]`);
  const slugField = field('slug'), tierField = field('tier'), clock = field('clock'), fact = field('stFact');
  if (slugField !== null && slugField.textContent === '') slugField.textContent = arrival?.name ?? slug.replaceAll('-', ' ');
  if (tierField !== null && tierField.textContent === '' && arrival?.tier !== undefined) tierField.textContent = arrival.tier;
  if (fact !== null && fact.textContent === '—') fact.textContent = engineString('s_loading_code');
  if (inline) return;
  const tick = (): void => { if (clock !== null) clock.textContent = clockText(diagnosticNow() - started); };
  tick(); shellClock = owner.child('shell.clock'); shellClock.interval(100, tick);
}
/** `Loading` owns the card from here. */
export function stopShellClock(): void { shellClock?.dispose(); shellClock = undefined; }

/** Paint an owned loading panel before a fresh-page handoff. The compiled caller
 * supplies navigation; no renderer or save service is imported by this shell. */
export function beginNavigationShell(name: string, owner: Scope, navigate: () => void, card?: HTMLButtonElement | null): Scope {
  if (owner.disposed || owner.disposing) throw new Error('Navigation shell requires a live owner');
  const attempt = owner.child('navigation'), html = document.documentElement, title = html.classList.contains('title-first');
  const existing = document.querySelector<HTMLElement>('.ws-load'), root = existing ?? document.createElement('div'), slots = new HudSlots();
  if (existing === null) { root.className = 'ws-load'; root.dataset['shell'] = ''; root.innerHTML = loadShellTemplate(); slots.widget('band.1', root, 0, attempt, document.body); }
  const hidden = root.classList.contains('hide'), nameField = root.querySelector<HTMLElement>('[data-el="slug"]');
  const previousName = nameField?.textContent ?? '', disabled = card?.disabled ?? false, busy = card?.getAttribute('aria-busy') ?? null;
  if (nameField !== null) nameField.textContent = name;
  root.classList.remove('hide'); root.dataset['navigation'] = '';
  html.classList.remove('title-first');
  if (card !== undefined && card !== null) { card.disabled = true; card.setAttribute('aria-busy', 'true'); }
  attempt.onDispose(() => {
    if (existing === null) slots.discard(root);
    else { root.classList.toggle('hide', hidden); delete root.dataset['navigation']; if (nameField !== null) nameField.textContent = previousName; }
    html.classList.toggle('title-first', title);
    if (card !== undefined && card !== null) { card.disabled = disabled; if (busy === null) card.removeAttribute('aria-busy'); else card.setAttribute('aria-busy', busy); }
  });
  // RAF runs before paint. A second frame leaves a complete paint opportunity
  // before synchronous storage work or navigation can block this document.
  attempt.raf(() => { attempt.raf(() => { try { navigate(); } catch (error) { attempt.dispose(); throw error; } }); });
  return attempt;
}
