import { expect, test } from 'vitest';
import { app } from '../app/runtime';
import { loadNavmesh, pageNavmeshWanted } from './navmeshLoad';

// ENGINE-MEMORY EM20: the server's worker holds the zone's one navmesh; the page builds one only for the tools that read it.
test('the page builds a navmesh only for the overlay or the probe', () => {
  expect(pageNavmeshWanted('')).toBe(false);
  expect(pageNavmeshWanted('?physics=debug')).toBe(false);
  expect(pageNavmeshWanted('?navmesh=debug')).toBe(true);
  expect(pageNavmeshWanted('?navmesh=page')).toBe(true);
});

test('a play page asks for no navigation bytes and holds no navmesh', async () => {
  const content = { row: { file: 'f'.repeat(64) }, get bytes(): Uint8Array { throw new Error('the page read navigation bytes'); } };
  await expect(loadNavmesh('nalati-grasslands', 'nalati-grasslands', content as never)).resolves.toBeNull();
  expect(app.navmesh).toBeNull();
});
