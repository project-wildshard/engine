import { expect, test } from 'vitest';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { bakedGridCollision } from './fixtures/gridCollision';
import { cell, HOME, NEIGHBOUR, PageStorage, serverInput, until } from './fixtures/standaloneGrid';

// J311 (Jake 2026-11-12: "every shard select in preview server also needs to be the infinite grid"): on a build with no world, the
// in-page server hosts the grid, and a Shard select pick starts its session in that shard's cell, wherever the device last stood.
// The next boot without a pick resumes in the picked cell. Only a server's bytes are read.
function start(storage: PageStorage, home: string, goto?: string): { shell: StandaloneShell; stop: () => void } {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, slug) => serverInput(slug), strips: bakedGridCollision, ...(goto === undefined ? {} : { goto }) });
  const shell = connectStandalone({ slug: home, base: `/shards/${home}/`, build: 'test', savePrefix: 'wildshard.', storage, ...(goto === undefined ? {} : { goto }) }, control.port2, game.port2, () => { server.dispose(); });
  return { shell, stop: () => { shell.dispose(); } };
}
async function standsIn(storage: PageStorage, home: string, goto?: string): Promise<number | undefined> {
  const { shell, stop } = start(storage, home, goto);
  await shell.booted;
  shell.ready();
  await until(() => shell.client.latest !== null);
  const at = shell.client.latest?.cell;
  expect((await shell.save()).ok).toBe(true);
  stop();
  return at;
}

test('a Shard select pick starts the in-page grid in its cell, and the next boot resumes there', { timeout: 120_000 }, async () => {
  const storage = new PageStorage();
  expect(await standsIn(storage, HOME), 'a fresh session opens in its home cell').toBe(cell(HOME));
  expect(await standsIn(storage, HOME), 'and resumes there').toBe(cell(HOME));
  expect(await standsIn(storage, NEIGHBOUR, NEIGHBOUR), 'Shard select → Driftwood: Driftwood\'s cell, not the saved one').toBe(cell(NEIGHBOUR));
  expect(await standsIn(storage, HOME), 'a later boot with no pick resumes where the pick left the player').toBe(cell(NEIGHBOUR));
  expect(await standsIn(storage, HOME, 'no-such-cell'), 'a pick the grid does not place keeps the saved site').toBe(cell(NEIGHBOUR));
});
