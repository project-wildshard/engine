import { expect, test } from 'vitest';
import { spentUses } from '../src/client/game/shard/declaredTargets';
import { copyPrompts } from '../src/client/game/grid/copyPrompts';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// TEMPLATE-E2E TC-E4c: Mossgate's sword rack kept its "Take the iron sword" prompt after the take (WebKit probe, engine
// 2b5af207), on the one-shard page and in a grid cell alike. A rack whose melee weapon is taken is spent, as a lever's rack
// is (TE-ENG6), and a grid copy's prompts now drop a spent use's reach too (they had no spent check at all).
const SWORD = 'weapon.sword-iron';
test('a taken sword\'s rack prompt is spent, standalone and in a grid copy', { timeout: 60_000 }, async () => {
  const shard = (await loadHeadlessFolder(builtFolder('_template'))).shardfile;
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

// TEMPLATE-E2E TC-SHIP-d: on staging v0.1.32 Brasscap's rack restock, its three camp ammo boxes and the strongbox showed no
// prompt: each is a kit.lever take, and the lever starts in hand, so the take rule above spent them all in a grid copy.
// The server restocks a taken lever on its take (TC-E1d, `declaredKitItems.ts`), so a lever's take is never spent.
const LEVER = 'weapon.brasscap-lever';
test('a taken lever\'s takes stay: Brasscap\'s rack, ammo boxes and strongbox restock it', { timeout: 60_000 }, async () => {
  const shard = (await loadHeadlessFolder(builtFolder('brasscap-mesa'))).shardfile;
  const takes = new Set((shard.targets.itemActions ?? []).filter(action => action.item === LEVER && action.action === 3).map(action => action.scene));
  const rows = shard.targets.interactions.filter(row => takes.has(row.scene));
  expect(rows.map(row => row.id).sort()).toEqual(['brasscap.ammo.camp-1', 'brasscap.ammo.camp-2', 'brasscap.ammo.camp-3', 'brasscap.rack.use', 'brasscap.strongbox.use']);
  const spent = spentUses(shard, { read: () => 0, taken: item => item === LEVER });
  expect(rows.filter(row => spent(row)).map(row => row.id)).toEqual([]);
  const prompts = copyPrompts(shard, spent);
  for (const row of rows) expect(prompts.find(entry => entry.wireId === row.id)?.radius).toBe(row.radius);
});
