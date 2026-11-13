// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { appIdentity } from '../../../shared/engine/app/identity';
import { deviceIdentity, GUEST, heldName } from '../../../shared/engine/net/identity';
import { saveEnvironment } from '../../../shared/engine/saves/environment';
import { askNameOnce, nameAskDue, nameSettingRows, savedName } from './namePrompt';

// MMO-PLAN MP2.4, the Name prompt (Jake, 2026-11-11): asked once per device between PLAY and the world.
const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); document.body.replaceChildren(); });
const scope = (): Scope => { const made = new Scope('name-prompt'); scopes.push(made); return made; };
const box = (): HTMLFormElement | null => document.querySelector<HTMLFormElement>('#ws-name-box');
const type = (text: string): void => { const input = box()?.querySelector('input'); if (input === null || input === undefined) throw new Error('no field'); input.value = text; input.dispatchEvent(new Event('input')); };
const submit = (): void => { box()?.requestSubmit(); };
const stored = (): NetName => { const storage = saveEnvironment().storage('global'); if (storage === null) throw new Error('no storage'); return { name: heldName(storage, appIdentity().savePrefix) }; };
interface NetName { readonly name: string | null }
const tick = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });
// happy-dom has no visualViewport: the page gets Safari's (MK9, below), in place before the first PLAY installs the marks on it
const PAGE = 714, view = Object.assign(new EventTarget(), { height: PAGE, offsetTop: 0, scale: 1 });
Object.defineProperty(window, 'innerHeight', { configurable: true, value: PAGE });
Object.defineProperty(window, 'visualViewport', { configurable: true, value: view });

test('a first PLAY shows the prompt; Let\'s go keeps the Name for the join; a second PLAY skips it', async () => {
  expect(nameAskDue()).toBe(true);
  const first = askNameOnce(scope(), { parent: document.body });
  expect(box()).not.toBeNull();
  expect(box()?.textContent).toContain('What should we call you?');
  expect(box()?.querySelector('button[type=submit]')?.textContent).toBe('Let\'s go');
  expect(box()?.querySelector('[data-name=skip]')?.textContent).toBe('Skip');
  type('  Matt  '); submit();
  expect(await first).toBe(true);
  expect(box()).toBeNull();
  expect(stored().name).toBe('Matt');
  expect(nameAskDue()).toBe(false);
  // what `hello` sends: the device's id with the Name (the server adds the #tag)
  const storage = saveEnvironment().storage('global');
  if (storage === null) throw new Error('no storage');
  expect(deviceIdentity(storage, appIdentity().savePrefix).name).toBe('Matt');
  // the second PLAY goes straight in
  expect(await askNameOnce(scope(), { parent: document.body })).toBe(true);
  expect(box()).toBeNull();
});

test('Skip keeps the default Name, and the device is not asked again', async () => {
  const first = askNameOnce(scope(), { parent: document.body });
  const skip = box()?.querySelector<HTMLButtonElement>('[data-name=skip]');
  if (skip === null || skip === undefined) throw new Error('no Skip');
  skip.click();
  expect(await first).toBe(true);
  expect(stored().name).toBe(null); // nothing typed: the join sends the device's own (Guest)
  expect(savedName()).toBe('');
  const storage = saveEnvironment().storage('global');
  if (storage === null) throw new Error('no storage');
  expect(deviceIdentity(storage, appIdentity().savePrefix).name).toBe(GUEST.name);
  expect(nameAskDue()).toBe(false);
  expect(await askNameOnce(scope(), { parent: document.body })).toBe(true);
  expect(box()).toBeNull();
});

test('the server\'s own rule refuses inline: an empty Name, or one with a listed word, stays on the prompt', async () => {
  const asking = askNameOnce(scope(), { parent: document.body });
  let done = false; void asking.then(() => { done = true; return done; });
  type('   '); submit(); await tick();
  expect(done).toBe(false);
  expect(box()?.querySelector('[role=alert]')?.textContent).toBe('Type a name, or tap Skip.');
  type('arse'); submit(); await tick();
  expect(done).toBe(false);
  expect(box()?.querySelector('[role=alert]')?.textContent).toBe('That name isn\'t allowed. Try another one.');
  expect(box()?.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  type('Ann'); expect(box()?.querySelector<HTMLElement>('[role=alert]')?.hidden).toBe(true);
  submit();
  expect(await asking).toBe(true);
  expect(stored().name).toBe('Ann');
});

test('the prompt fills in a Name the device already keeps', async () => {
  const storage = saveEnvironment().storage('global');
  if (storage === null) throw new Error('no storage');
  deviceIdentity(storage, appIdentity().savePrefix, 'Jake');
  const asking = askNameOnce(scope(), { parent: document.body });
  expect(box()?.querySelector('input')?.value).toBe('Jake');
  submit();
  expect(await asking).toBe(true);
  expect(stored().name).toBe('Jake');
});

test('a closed page ends the prompt unanswered: the next PLAY asks again', async () => {
  const owner = scope(), asking = askNameOnce(owner, { parent: document.body });
  owner.dispose();
  expect(await asking).toBe(false);
  expect(box()).toBeNull();
  expect(nameAskDue()).toBe(true);
});

test('Settings ▸ System ▸ Name changes the Name, by the same rule', () => {
  const [row, note] = nameSettingRows(scope());
  if (row === undefined || note === undefined) throw new Error('no rows');
  document.body.append(row, note);
  const input = row.querySelector('input');
  if (input === null) throw new Error('no field');
  input.value = 'arse'; (row as HTMLFormElement).requestSubmit();
  expect(note.hidden).toBe(false); expect(note.dataset['tone']).toBe('refused');
  expect(stored().name).toBe(null);
  input.value = 'Matt'; (row as HTMLFormElement).requestSubmit();
  expect(note.dataset['tone']).toBe('ok');
  expect(stored().name).toBe('Matt');
  expect(nameAskDue()).toBe(false);
});

// MOBILE-KEYBOARD MK9 (meta, J297): the Name card fits above a phone's keyboard by viewport.ts's marks, the one module that owns
// the keyboard, not by a `visualViewport` fit of its own. The numbers are MK1's iOS 26 Simulator reading (iPhone 17 Pro, Safari):
// the page 714 tall, the keyboard up, the visible band 377 tall and panned 213 down. The title asks before any Game has
// installed the marks, so the prompt installs them.
test('MK9: the prompt reads the keyboard marks, with no visualViewport fit of its own', async () => {
  const root = document.documentElement;
  try {
    const owner = scope(), asking = askNameOnce(owner, { parent: document.body });
    const form = box();
    if (form === null) throw new Error('no prompt');
    expect(document.activeElement).toBe(form.querySelector('input'));
    expect(root.dataset['wsKeyboard']).toBeUndefined(); // focus alone, no keyboard yet
    // the keyboard rises: Safari shrinks the visual viewport and pans the page
    view.height = 377; view.offsetTop = 213; view.dispatchEvent(new Event('resize'));
    expect(root.dataset['wsKeyboard']).toBe('');
    expect(root.style.getPropertyValue('--ws-kb-top')).toBe('213px');
    expect(root.style.getPropertyValue('--ws-kb-bottom')).toBe('590px');
    // the card's own box carries no fit: namePrompt.css places it in the marked band
    expect(form.style.top).toBe('');
    expect(form.style.height).toBe('');
    // oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheet's rule, not a copy of it
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/client/engine/ui/styles/namePrompt.css', 'utf8').replaceAll(/\s+/g, ' ')).toContain('html[data-ws-keyboard] .ws-name { top: var(--ws-kb-top, 0px); height: calc(var(--ws-kb-bottom, 100%) - var(--ws-kb-top, 0px)); }');
    owner.dispose();
    expect(await asking).toBe(false);
  } finally {
    // the keyboard drops, so viewport.ts's own state closes too (claude -p review)
    view.height = PAGE; view.offsetTop = 0; view.dispatchEvent(new Event('resize'));
    delete root.dataset['wsKeyboard'];
    for (const name of ['--ws-vh', '--ws-kb-top', '--ws-kb-bottom', '--ws-home']) root.style.removeProperty(name);
  }
});
