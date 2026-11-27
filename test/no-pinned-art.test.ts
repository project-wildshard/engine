// SF10 (J525): every zone's art rides in its own shardfile, so engine fetches no art from a shard repo. A pins install
// reads the API's shardfiles only; `test/pins/assets.json` and the GitHub fetch behind it (`pin-assets.ts`) are gone and
// stay gone.
// oxlint-disable-next-line import/no-nodejs-modules -- the test reads the tree.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {expect, test} from 'vitest';

const GITHUB_ART = /raw\.githubusercontent\.com|api\.github\.com\/repos\/[^`'"]*\/contents\//u;

test('no pinned repo art list, cache or fetcher comes back', () => {
  for (const path of ['test/pins/assets.json', 'test/pins/assets', 'src/scripts/pin-assets.ts']) expect(existsSync(path), path).toBe(false);
});

test('the pins install fetches nothing from GitHub', () => {
  const install = readdirSync('src/scripts').filter(name => /^pins?(?:[-.].*)?\.(?:ts|mjs)$/u.test(name) && !name.includes('.test.'));
  expect(install).toContain('pins.ts');
  for (const name of install) expect(GITHUB_ART.test(readFileSync(`src/scripts/${name}`, 'utf8')), name).toBe(false);
});
