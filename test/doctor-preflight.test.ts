// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { doctorPreflight, openDoctorPage } from '../src/client/engine/ui/errorScreen';

// FM8 mode 14 (meta MMO-FAILURE-MODES-PLAN): the Connection doctor opens only after its own page answers a preflight; one that
// doesn't leaves the player's page as it was, with a card that says so.
afterEach(() => { document.body.replaceChildren(); });

test('the preflight names what it measured, and a pass claims nothing more', async () => {
  const methods: string[] = [];
  expect(await doctorPreflight('/doctor/?sw=0', (_url, init) => { methods.push(String(init?.method)); return Promise.resolve(new Response(null, { status: 200 })); })).toBeNull();
  expect(methods).toEqual(['HEAD']);
  expect(await doctorPreflight('/doctor/', () => Promise.resolve(new Response(null, { status: 503 })))).toBe('HTTP 503');
  expect(await doctorPreflight('/doctor/', () => Promise.reject(new TypeError('Failed to fetch')))).toBe('No HTTP response');
  const hanging: typeof fetch = (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); }); });
  expect(await doctorPreflight('/doctor/', hanging, 20)).toBe('No answer in 0 s');
});

test('a doctor that does not answer keeps the page, shows doctor-http, and Try again checks again', async () => {
  let reads = 0;
  const failing: typeof fetch = () => { reads++; return Promise.resolve(new Response(null, { status: 502 })); };
  const before = location.href;
  expect(await openDoctorPage('settings', failing)).toBe(false);
  expect(location.href).toBe(before);
  const card = document.querySelector<HTMLElement>('[data-failmode="doctor-http"]');
  expect(card?.textContent).toContain('The check didn\'t open');
  const primary = card?.cloneNode(true) as HTMLElement; for (const part of primary.querySelectorAll('details, button')) part.remove();
  expect(primary.textContent).not.toMatch(/502|https?:/u);
  expect(card?.querySelector('details')?.textContent).toContain('HTTP 502');
  card?.querySelector<HTMLButtonElement>('button.go')?.click();
  await new Promise(resolve => { setTimeout(resolve, 0); });
  expect(reads).toBe(2);
  expect(document.querySelectorAll('[data-failmode="doctor-http"]')).toHaveLength(1);
  [...document.querySelectorAll<HTMLButtonElement>('[data-failmode="doctor-http"] button')].find(button => button.textContent === 'Back to the game')?.click();
  expect(document.querySelector('[data-failmode="doctor-http"]')).toBeNull();
});
