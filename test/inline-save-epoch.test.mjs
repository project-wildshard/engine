import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const epoch = JSON.parse(readFileSync(new URL('../save-epoch.json', import.meta.url), 'utf8')).saveEpoch;
const prefix = `wildshard.save.v2@${epoch}.`;
function script(attribute) {
  const body = html.match(new RegExp(`<script ${attribute}>([\\s\\S]*?)</script>`))?.[1];
  if (!body) throw new Error(`Missing inline ${attribute}`);
  return body;
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function retry(sessionStorage) {
  let timer, reloads = 0;
  runInNewContext(script('data-loading-first-paint'), {
    document: { documentElement: { hasAttribute: () => false }, querySelector: () => ({}) },
    sessionStorage, location: { reload: () => { reloads++; } },
    setTimeout: callback => { timer = callback; },
  });
  timer();
  return reloads;
}
test('the real pre-module retry and runtime share one epoch guard', () => {
  const session = storage();
  expect(retry(session)).toBe(1);
  expect(JSON.parse(session.getItem(`${prefix}session`)).keys['boot.selfReload']).toBeDefined();
  expect(retry(session)).toBe(0);
  expect(session.getItem('wildshard.save.v2.session')).toBeNull();
});
test('the pre-module clock consumes the current epoch title handoff', () => {
  const fields = { clock: {}, slug: {}, tier: {} };
  const card = { dataset: {}, querySelector: selector => fields[selector.match(/"(.*?)"/)[1]] };
  const arrival = { slug: 'pine-hollow', at: Date.now(), name: 'Pine Hollow', tier: 'Explorer' };
  runInNewContext(script('data-loading-clock'), {
    document: { querySelector: () => card }, location: { search: '?chunk=pine-hollow' }, URLSearchParams,
    sessionStorage: storage({ [`${prefix}session`]: JSON.stringify({ keys: { titleArrival: { data: arrival } } }) }),
    localStorage: storage(), performance: { now: () => 20, timeOrigin: arrival.at }, setInterval: () => 1,
  });
  expect(fields.slug.textContent).toBe('Pine Hollow');
  expect(fields.tier.textContent).toBe('Explorer');
  expect(fields.clock.textContent).toBe('00:00.0');
});
