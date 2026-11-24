// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installShards } from './shard/list';
import { markNameAsked } from '@wildshard/engine/ui/namePrompt';
import { buildTitleMenu } from './mainMenu';
import { HANDOVER_QUIET_MS, HANDOVER_REASON, armTitleHandover } from './titleHandover';
import { Scope } from '@wildshard/engine/app/scope';
import type { TitleCard } from './titleDeck';

/** STAGING-BUGBASH SB37b (K2 `old-cache-first-page`): an old title gives way to the candidate once its worker activates.
 *  The page reloads itself, only while it sits idle on the main screen; the worker never navigates it (a menu the player
 *  has open is never snatched), and no document is claimed (039d). */
const card = (slug: string, name: string): TitleCard => ({ slug, name, label: name, thumbnail: '', heroPortrait: '', heroLandscape: '' });
const CARDS = [card('driftwood-isle', 'Driftwood Isle'), card('nalati', 'Nalati')];
const views: { dispose: () => void }[] = [];
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installShards([]); markNameAsked();
  vi.useFakeTimers();
  reload = vi.fn();
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/'), { reload, replace: vi.fn() }));
});
afterEach(() => {
  for (const view of views.splice(0)) view.dispose();
  document.body.replaceChildren(); Reflect.deleteProperty(window, '__ws_sw');
  vi.useRealTimers(); vi.unstubAllGlobals();
});

const title = (active: string | null = null) => {
  const view = buildTitleMenu({ cards: CARDS, active, onEnter: () => undefined, onSettings: () => undefined, onGrid: () => undefined });
  document.body.append(view.root); views.push(view); view.start();
  return view;
};
const activated = (build = 'fixture-after'): void => { window.dispatchEvent(new CustomEvent('ws-sw-activated', { detail: { build } })); };

test('SB37b: an idle old title reloads into the candidate within 20 s of its worker activating', async () => {
  title();
  activated();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(reload).toHaveBeenCalledOnce();
});

test('SB37b: a worker that activated before the title was built still hands the title over', async () => {
  Object.defineProperty(window, '__ws_sw', { configurable: true, value: { activated: 'fixture-after' } });
  title();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(reload).toHaveBeenCalledOnce();
});

test('SB37b: an open menu is never snatched; the title goes once it is closed and quiet', async () => {
  const view = title();
  view.show('select'); // ZONE SELECT open
  activated();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).not.toHaveBeenCalled();
  // Settings open over the main screen: still not idle
  view.show('main');
  const settings = document.createElement('div'); settings.className = 'ws-gmenu show'; document.body.append(settings);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).not.toHaveBeenCalled();
  // the tap that closes Settings: the player is still using the screen
  window.dispatchEvent(new PointerEvent('pointerdown'));
  settings.remove();
  await vi.advanceTimersByTimeAsync(HANDOVER_QUIET_MS - 1000);
  expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000);
  expect(reload).toHaveBeenCalledOnce();
});

// QA-FEEDBACK-2026-11-24 row 7 (Jake, ~12:05 Cancún: "whenever theres a new update its a frozen screen for 10 seconds"): index.html's
// portrait guard is an aria-modal dialog hidden in portrait, and it matched on every page, so no title ever handed over
test('QA 11-24 row 7: a hidden dialog (the portrait guard) or a dismissed drop card never holds the hand-over', async () => {
  title();
  const rotate = document.createElement('div'); rotate.className = 'ws-rotate'; rotate.setAttribute('role', 'alertdialog'); rotate.setAttribute('aria-modal', 'true');
  rotate.style.display = 'none'; document.body.append(rotate);
  const drop = document.createElement('div'); drop.id = 'wsdrop'; drop.style.display = 'none'; document.body.append(drop);
  activated();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(reload).toHaveBeenCalledOnce();
});

test('SB37b: a dialog (the Name prompt, sign-in) holds the hand-over too', async () => {
  title();
  const dialog = document.createElement('form'); dialog.setAttribute('aria-modal', 'true'); document.body.append(dialog);
  activated();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).not.toHaveBeenCalled();
});

test('SB37b: a page a hand-over opened never hands over again (no loop), and a world page\'s pause ▸ EXIT TO MAIN never does', async () => {
  const owner = new Scope('test.handover');
  armTitleHandover(owner, () => true, { kind: 'intentional', reason: `${HANDOVER_REASON}: new build fixture activated behind it` });
  activated();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reload).not.toHaveBeenCalled();
  owner.dispose();
  title('driftwood-isle');
  activated();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reload).not.toHaveBeenCalled();
});

test('SB37b: an ENTER THE MMO tap waiting on its gate holds the hand-over; a refused gate gives it back', async () => {
  let release: () => void = () => undefined;
  const gate = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const view = buildTitleMenu({ cards: CARDS, active: null, gate, onEnter: () => undefined, onSettings: () => undefined, onGrid: () => undefined });
  document.body.append(view.root); views.push(view); view.start();
  activated();
  document.querySelector('.ws-main-mmo')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(0);
  expect(gate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reload).not.toHaveBeenCalled();
  release(); // the gate refused (never called go): the title is idle again
  await vi.advanceTimersByTimeAsync(20_000);
  expect(reload).toHaveBeenCalledOnce();
});
