import { expect, test } from 'vitest';
import { spentUses } from '../src/client/game/shard/declaredTargets';
import { copyPrompts } from '../src/client/game/grid/copyPrompts';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from '../src/test/game/builtProduct';

// TEMPLATE-E2E TC-E4c: Mossgate's sword rack kept its "Take the iron sword" prompt after the take (WebKit probe, engine
// 2b5af207), on the one-shard page and in a grid cell alike. A rack whose melee weapon is taken is spent, as a lever's rack
// is (TE-ENG6), and a grid copy's prompts now drop a spent use's reach too (they had no spent check at all).
const SWORD = 'weapon.sword-iron';
test('a taken sword\'s rack prompt is spent, standalone and in a grid copy', { timeout: 60_000 }, async () => {
  const shard = (await loadHeadlessProduct(builtProduct('_template'))).shardfile;
  const rack = shard.targets.interactions.find(row => (shard.targets.itemActions ?? []).some(action => action.scene === row.scene && action.item === SWORD));
  if (rack === undefined) throw new Error('Template rev 8 racks its sword');
  let taken = false;
  const spent = spentUses(shard, { read: () => 0, taken: item => item === SWORD && taken });
  expect(spent(rack)).toBe(false);
  taken = true;
  expect(spent(rack)).toBe(true);

  // a grid copy: the prompt keeps its place, and has no reach while spent
  taken = false;
  const prompts = copyPrompts(shard, spent), prompt = prompts.find(entry => entry.wireId === rack.id);
  expect(prompt?.radius).toBe(rack.radius);
  taken = true;
  expect(prompt?.radius).toBe(0);
  expect(prompts.map(entry => entry.wireId)).toEqual(shard.targets.interactions.map(row => row.id));
});
