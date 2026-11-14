import { parsePageLife } from '@wildshard/format/pageLife';
import { parseCoverAppearance } from '@wildshard/format/coverAppearance';
import { HeldEquipmentSchema } from '@wildshard/format/heldEquipment';
import { outputPlatformPayloads } from '../src/sharddev/outputProduct';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { readPineProject } from './fixtures/pine-project';
import { RangedPageSchema } from '@wildshard/format/rangedPage';

// The Pine client's product reads (sp-o270): every custom section and named blob runtime/ asks the built output for is
// emitted, with the shapes the readers convert (skin pickups, wildlife voices, mount packs).
// Generation is fixture preparation (readPineProject: the CLI's declared roots); the 30 s case only reads the output.
const pine = await readPineProject();

test('Pine client reads resolve against the emitted output', () => {
  const loaded = pine;
  expect(Object.hasOwn(loaded.output, 'custom')).toBe(false);
  const rows = loaded.shard.items.pickups ?? {};
  expect(Object.keys(rows).sort()).toEqual(['blackpaw', 'ghost-stag', 'hollow-ash', 'imperial', 'ironhide', 'scarback-furnace', 'warden']);
  expect(loaded.shard.quests.achievements?.length).toBeGreaterThan(0);
  expect(loaded.shard.items.catalogue?.length).toBeGreaterThan(0);
  expect(loaded.output.namedFiles?.some(row => row.name === 'custom/questInventory')).toBe(false);
  const shots = loaded.shard.audio.bank?.shots;
  if(shots===undefined)throw new Error('Pine admitted voice identities absent');
  const lifeFile = loaded.output.namedFiles?.find(row => row.name === 'actors/page-life.json');
  const lifeBytes = lifeFile === undefined ? undefined : loaded.assets.get(lifeFile.hash);
  if (lifeBytes === undefined) throw new Error('Pine output has no ambient page');
  const life = parsePageLife(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(lifeBytes)));
  const voices = [...life.flocks.filter(row => row.audio === 'bank').flatMap(({ row }) => [
    row.call?.cue, row.scavenge?.voices.call, row.scavenge?.voices.pair, row.scavenge?.voices.flap,
    row.visit?.call?.cue, row.visit?.callCue, row.visit?.acts?.drum?.cue,
  ].filter((cue): cue is string => cue !== undefined && cue !== null)),
    ...(life.guide === undefined ? [] : [life.guide.cue]), ...(life.harvest?.sounds ?? [])];
  for (const voice of voices) expect(shots.includes(voice), voice).toBe(true);
  expect(loaded.output.namedFiles?.some(row => row.name === 'custom/ambientLife')).toBe(false);
  expect(shots.length).toBe(new Set(shots).size);
  const rangedFile = loaded.output.namedFiles?.find(row => row.name === 'client/ranged-page.json');
  const rangedBytes = rangedFile === undefined ? undefined : loaded.assets.get(rangedFile.hash);
  if (rangedBytes === undefined) throw new Error('Pine defining ranged page absent');
  const ranged = v.parse(RangedPageSchema, JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rangedBytes)));
  for (const geometry of ranged.collection.pack.rows.geometries) expect(geometry.own).toBeNull();
  const names = new Set(loaded.output.namedFiles?.map(row => row.name));
  const coverFile = loaded.output.namedFiles?.find(row => row.name === 'look/cover-appearance.json');
  const coverBytes = coverFile === undefined ? undefined : loaded.assets.get(coverFile.hash);
  if (coverBytes === undefined) throw new Error('Pine output has no cover appearance');
  const appearance = parseCoverAppearance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(coverBytes)));
  expect(Object.keys(appearance.textures).sort()).toEqual(['endGrain', 'ferns', 'glow', 'litter', 'moss', 'reeds', 'shrubs', 'stones']);
  const held = v.parse(HeldEquipmentSchema, outputPlatformPayloads(loaded.output.platform,['held/equipment']).get('held/equipment'));
  const textures = {coatArm:held.coatTextures.armMap,coatMap:held.coatTextures.map,coatNormal:held.coatTextures.normalMap,chalk:ranged.collection.texture};
  expect(Object.keys(textures).sort()).toEqual(['chalk', 'coatArm', 'coatMap', 'coatNormal']);
  const wanted = [held.firearm.pool.url, held.launcher.pool.url, ranged.collection.pack.url,
    ...Object.values(textures).map(row => row.url),
    ...Object.values(appearance.textures).map(row => row.url),
    'world/forest-page.json', 'actors/elites.json', ...['night', 'director'].map(stem => `behaviour/${stem}.wasm`),
    ...['ironhide', 'ghost-stag', 'blackpaw', 'imperial-bull'].map(stem => `behaviour/elites/${stem}.wasm`)];
  for (const name of wanted) expect(names.has(name), name).toBe(true);
}, 30000);
