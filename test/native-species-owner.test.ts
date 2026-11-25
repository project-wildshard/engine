// P1 (Jake, 2026-11-22 ~21:15 Cancún: "all enemies dont render they are invisible"): staging v0.1.72 baked Driftwood r8's
// client product (it still carried the old programme section) beside the box's r9, and nobody declared Driftwood's species,
// so every crab, monkey, sailor and the Captain arrived on the wire as "a row of 'crab' has no species on this page; not
// drawn". Every pinned native page's spawns must have a species owner and a look.
import { expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';
import { nativeDeclaresOwnSpecies } from '../src/client/game/shardfile/declaredCreatures';

const NATIVE = ['driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack'].filter(slug => existsSync(resolve('out', slug, 'shard.json')));

test.each(NATIVE)('%s: every spawned species is declared by its page, and has a look', async slug => {
  const folder = await loadHeadlessFolder(builtFolder(slug)), source = folder.shardfile;
  if (source.runtime === null || hasDeclaredClientPage(source) || source.creatures.spawns.length === 0) return;
  // FORMAT-PRUNE FP20: the species-program features and section are deleted, so the page itself owns its species
  expect(nativeDeclaresOwnSpecies(folder), `${slug}: no owner declares its species`).toBe(true);
  const looks = new Set(source.rows.looks.map(look => look.species));
  for (const spawn of source.creatures.spawns) {
    const species = source.rows.species.find(row => row.id === spawn.species);
    expect(species, `${slug}: ${spawn.species} has a species row`).toBeDefined();
    expect(looks.has(spawn.species), `${slug}: ${spawn.species} has a look`).toBe(true);
  }
});
