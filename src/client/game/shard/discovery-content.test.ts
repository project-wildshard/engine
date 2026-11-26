// @vitest-environment happy-dom
// STAGING-BUGBASH SB27 (opus-ss16p, 2026-11-16): staging v0.1.30 and prod v0.1.29 read every title row's discovery document
// from the page's own `/shardfiles/`, which 404s since PAGE-SIZE moved shard content to the content base, so the title's
// SETTINGS (it awaits the whole catalogue) never opened.
import { afterEach, expect, test } from 'vitest';

import { discoveryHome, readDiscovery } from './discovery';

const ROW = { slug: 'driftwood-isle', discovery: '/shardfiles/driftwood-isle/discovery.json?v=8be404db' } as const;

function bank(contentBase: string): void {
  const node = document.createElement('script');
  node.type = 'application/json'; node.id = 'boot-module-files'; node.textContent = JSON.stringify({ contentBase });
  document.head.append(node);
}
async function asked(): Promise<string[]> {
  const urls: string[] = [];
  await expect(readDiscovery(ROW, (url) => { urls.push(url instanceof Request ? url.url : url.toString()); return Promise.resolve(new Response('', { status: 404 })); }))
    .rejects.toThrow('Discovery of driftwood-isle answered 404');
  return urls;
}
afterEach(() => { document.getElementById('boot-module-files')?.remove(); });

test('a title row\'s discovery document is read from the content base the boot bank names', async () => {
  bank('https://packs.wildshard.io/content/0a3968a65a4ec3c4/');
  expect(await asked()).toEqual(['https://packs.wildshard.io/content/0a3968a65a4ec3c4/shardfiles/driftwood-isle/discovery.json?v=8be404db']);
});

test('with no content base the discovery document stays on the page', async () => {
  expect(await asked()).toEqual(['/shardfiles/driftwood-isle/discovery.json?v=8be404db']);
});

// Meta QA 11-25 row 144 (nightly 45818175476): a stored cook's title row reads its discovery under its upload's loose folder;
// its art took the origin alone as home, so the Explorer's images 404'd on the cook's origin.
test('a row\'s art is read where its discovery document is, its loose folder kept', () => {
  const loose = `loose/${'a'.repeat(64)}`;
  expect(discoveryHome(`http://127.0.0.1:4173/${loose}/shardfiles/open-plot-alien-plain/discovery.json`)).toBe(`http://127.0.0.1:4173/${loose}`);
  expect(discoveryHome('https://packs.wildshard.io/shardfiles/driftwood-isle/discovery.json?v=8be404db')).toBe('https://packs.wildshard.io');
  expect(discoveryHome(ROW.discovery)).toBeUndefined();
});
