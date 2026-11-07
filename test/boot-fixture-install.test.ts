import {expect,test} from 'vitest';
import {installCatalogueFixture} from './fixtures/bootSetup';
import {installShards,shards} from '../src/client/game/shard/list';
import {selectedLevel} from '../src/shared/engine/level/selection';

test('a cached catalogue module restores its real rows without selecting a world',async()=>{
  const level=selectedLevel();
  await installCatalogueFixture();
  const before=shards();
  expect(before.length).toBeGreaterThan(0);expect(selectedLevel()).toBe(level);
  try{
    installShards([]);expect(shards()).toHaveLength(0);
    await installCatalogueFixture();
    expect(shards().map(row=>row.slug)).toEqual(before.map(row=>row.slug));
    expect(selectedLevel()).toBe(level);
  }finally{await installCatalogueFixture();}
});
