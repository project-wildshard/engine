// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Assert actual first-document CSS/module order.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { loadShellTemplate, beginNavigationShell, waitForLoadingStyles } from './shell';
import { guardBoot } from './stuck';
import { saveStorage } from '../saves/slots';
import { bootWaits } from '../../../shared/engine/boot/waits';

const native = scopeEnvironment();
let owner = new Scope('tap-test'), next = 1;
const queued = new Map<number, (time: number) => void>();
beforeEach(() => {
  owner = new Scope('tap-test'); queued.clear();
  installScopeEnvironment({ ...native, frame: render => { const id = next++; queued.set(id, render); return id; }, cancelFrame: id => { queued.delete(id); } });
  document.documentElement.className = 'title-first'; document.body.innerHTML = '<button class="ws-main-grid">Enter world</button>';
  document.head.innerHTML = `<style>html.title-first .ws-load{display:none}${readFileSync('src/client/engine/ui/loading.css', 'utf8')}</style>`;
});
afterEach(() => { owner.dispose(); installScopeEnvironment(native); document.head.innerHTML = ''; document.body.innerHTML = ''; document.documentElement.className = ''; });
function frame(time: number): void { const due = [...queued.values()]; queued.clear(); for (const render of due) render(time); }
function card(): HTMLButtonElement { const button = document.querySelector<HTMLButtonElement>('.ws-main-grid'); if (button === null) throw new Error('No title card'); return button; }

test('the loader stylesheet is available before any application module executes', () => {
  const html = readFileSync('index.html', 'utf8'), sheet = html.indexOf('href="/src/client/engine/ui/loading.css"');
  expect(sheet).toBeGreaterThan(0); expect(sheet).toBeLessThan(html.indexOf('<script type="module"'));
  expect(html).toContain('class="ws-load" data-shell');
});

test('a tap displays the real shell, paints a 30 Hz frame, then hands off exactly once', () => {
  document.body.insertAdjacentHTML('beforeend', `<div class="ws-load hide" data-shell>${loadShellTemplate()}</div>`);
  const navigate = vi.fn<() => void>(), button = card();
  owner.listen(button, 'click', () => { beginNavigationShell('The Home Island', owner, navigate, button); });
  button.click(); button.click();
  const shell = document.querySelector('.ws-load'); if (shell === null) throw new Error('Tap removed its shell');
  expect(document.querySelectorAll('.ws-load')).toHaveLength(1); expect(getComputedStyle(shell).display).toBe('flex');
  expect(shell.querySelector('[data-el="slug"]')?.textContent).toBe('The Home Island');
  expect(button.disabled).toBe(true); expect(button.getAttribute('aria-busy')).toBe('true');
  expect(navigate).not.toHaveBeenCalled(); expect(queued.size).toBe(1);
  frame(1000 / 30); expect(navigate).not.toHaveBeenCalled(); expect(getComputedStyle(shell).display).toBe('flex');
  frame(2000 / 30); expect(navigate).toHaveBeenCalledTimes(1); expect(queued.size).toBe(0);
});

test('a running page creates the identical retired shell and a handoff failure restores its title/card', () => {
  beginNavigationShell('Home', owner, () => { throw new Error('Navigation refused'); }, card());
  const expected = document.createElement('div'); expected.innerHTML = loadShellTemplate();
  const destination = expected.querySelector('[data-el="slug"]'); if (destination === null) throw new Error('Template lost its destination');
  destination.textContent = 'Home'; expect(document.querySelector('.ws-load')?.innerHTML).toBe(expected.innerHTML);
  frame(16); expect(() => frame(32)).toThrow('Navigation refused');
  expect(document.querySelector('.ws-load')).toBeNull(); expect(document.documentElement.classList.contains('title-first')).toBe(true);
  expect(card().disabled).toBe(false); expect(card().hasAttribute('aria-busy')).toBe(false);
});

test('failure restores an adopted panel and a later user tap may start a new attempt', () => {
  const root = document.createElement('div'); root.className = 'ws-load hide'; root.innerHTML = loadShellTemplate(); document.body.append(root);
  const attempt = beginNavigationShell('Home', owner, () => { throw new Error('Navigation refused'); }, card());
  frame(16); expect(() => frame(32)).toThrow('Navigation refused'); expect(attempt.disposed).toBe(true);
  expect(root.className).toBe('ws-load hide'); expect(Object.hasOwn(root.dataset, 'navigation')).toBe(false);
  expect(root.querySelector('[data-el="slug"]')?.textContent).toBe('');
  const navigate = vi.fn<() => void>(); beginNavigationShell('Home', owner, navigate, card());
  frame(48); frame(64); expect(navigate).toHaveBeenCalledTimes(1);
});

test('ancestor retirement cancels the handoff between its two frames', () => {
  const navigate = vi.fn<() => void>(), child = owner.child('title');
  beginNavigationShell('Home', child, navigate, card()); frame(16); owner.dispose(); frame(32);
  expect(navigate).not.toHaveBeenCalled(); expect(queued.size).toBe(0); expect(document.querySelector('.ws-load')).toBeNull();
});

test('the lightweight shell retires without touching a running canvas or HUD', () => {
  document.documentElement.className = ''; const canvas = document.createElement('canvas'), hud = document.createElement('div');
  canvas.id = 'game'; hud.id = 'hud'; document.body.append(canvas, hud);
  beginNavigationShell('A different home', owner, () => undefined);
  expect(canvas.isConnected && hud.isConnected).toBe(true); expect(owner.census.nodes).toBe(1); owner.dispose();
  expect(document.documentElement.classList.contains('title-first')).toBe(false);
  expect(canvas.isConnected && hud.isConnected).toBe(true); expect(document.querySelector('.ws-load')).toBeNull();
});

test('a retired owner refuses before creating a loader or scheduling work', () => {
  owner.dispose(); const navigate = vi.fn<() => void>();
  expect(() => beginNavigationShell('Home', owner, navigate, card())).toThrow('live owner');
  expect(document.querySelector('.ws-load')).toBeNull(); expect(queued.size).toBe(0); expect(navigate).not.toHaveBeenCalled();
});

test('RL4 / MF3: a slow boot shows nothing; a rejected boot reloads once with no card, then the error modal after a retry', async () => {
  vi.useFakeTimers();
  const reload = vi.fn<() => void>(), fetch = vi.fn();
  vi.stubGlobal('location', { href: 'https://boot.test/', pathname: '/', search: '', reload });
  vi.stubGlobal('fetch', fetch);
  sessionStorage.removeItem('wildshard.save.v2.session');
  let finish = (): void => undefined;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  try {
    guardBoot(pending);
    await vi.advanceTimersByTimeAsync(60_000); expect(document.querySelector('#wsstuck')).toBeNull(); expect(reload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled(); // no network or worker probe while a boot is merely slow
    guardBoot(Promise.reject(new Error('main chunk 404'))); await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1); expect(document.querySelector('#wsstuck')).toBeNull(); // the error report is the only fetch
    expect(saveStorage('session').getItem('boot.selfReload')).toBeTypeOf('string'); // index.html's 12 s retry is spent too
    guardBoot(Promise.reject(new Error('main chunk 404'))); await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => { expect(document.querySelector('#wserr')?.textContent ?? '').toContain('failed to start'); });
    expect(reload).toHaveBeenCalledTimes(1); expect(document.querySelector('#wsstuck')).toBeNull();
  } finally { finish(); await Promise.resolve(); sessionStorage.removeItem('wildshard.save.v2.session'); document.querySelector('#wserr')?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); }
});

function pendingStyle(name: string): HTMLLinkElement {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.media = 'print';
  // Expose a native resource identity without starting network in this event fixture.
  Object.defineProperty(link, 'href', { value: `https://styles.test/${name}.css` });
  document.head.append(link); return link;
}

test('startup styles retain the first-paint owner and name each actual pending sheet', async () => {
  document.body.insertAdjacentHTML('beforeend', `<div class="ws-load" data-shell>${loadShellTemplate()}</div>`);
  const first = pendingStyle('first'), second = pendingStyle('second'), entered = vi.fn();
  const loading = waitForLoadingStyles(owner).then(entered);
  expect(bootWaits().map(wait => ({label: wait.label, resource: wait.resource}))).toEqual([
    {label: 'Stylesheet download', resource: 'https://styles.test/first.css'}, {label: 'Stylesheet download', resource: 'https://styles.test/second.css'}]);
  first.dispatchEvent(new Event('load')); await Promise.resolve(); expect(entered).not.toHaveBeenCalled();
  expect(bootWaits().map(wait => ({label: wait.label, resource: wait.resource}))).toEqual([{label: 'Stylesheet download', resource: 'https://styles.test/second.css'}]);
  second.dispatchEvent(new Event('load')); await loading;
  expect(entered).toHaveBeenCalledTimes(1);
  expect(bootWaits()).toEqual([]);
  expect(document.querySelector('.ws-load[data-shell]')).not.toBeNull();
});

test('a failed stylesheet and a retired style owner refuse without starting the page', async () => {
  const link = pendingStyle('failed'), failed = waitForLoadingStyles(owner);
  const observed = expect(failed).rejects.toThrow('Stylesheet failed: https://styles.test/failed.css');
  link.dispatchEvent(new Event('error')); await observed;
  const retired = waitForLoadingStyles(owner), cancellation = expect(retired).rejects.toMatchObject({ name: 'AbortError' });
  owner.dispose(); await cancellation;
});

test('already parsed or disabled sheets never add a startup wait', async () => {
  const parsed = pendingStyle('parsed'), disabled = pendingStyle('disabled'); disabled.disabled = true;
  Object.defineProperty(parsed, 'sheet', { value: new CSSStyleSheet() });
  await waitForLoadingStyles(owner);
  owner.dispose(); await expect(waitForLoadingStyles(owner)).rejects.toThrow('live owner');
});
