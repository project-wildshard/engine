// Engine witness of the original pickup bake against immutable authored input tables.
// Invoke with the native bake loader; reads committed files only.
// GR9 / GR10 (a) (G798): a plain script, run by hand when pickups change; its outputs (src/client/game/data/pickupCatalogue.json
// and public/assets/baked/common/pickups/*.bin) are committed files, not catalogue outputs. --check verifies them.
import { createHash } from 'node:crypto';
import { zlibSync, unzlibSync } from 'fflate';
import { authoredPickups } from '@wildshard/engine/game/generators/pickups';
import { readFileSync } from 'node:fs';
import { jsonBytes } from '../../scripts/bake-output.mjs';
import { liveJson } from './livePin.ts';
import { parse, object, record, string } from 'valibot';
import { QuestInteractionTableSchema } from '@wildshard/format/questInteractionSource';
import { installKitProps } from '@wildshard/engine/game/models/interact';
import { Interactables, Live } from '@wildshard/engine/world/interact/Interactables';
import { pickupLook, registerPickupLook } from '@wildshard/engine/world/interact/types';
import { readBakedGeometry } from '@wildshard/engine/game/plugin/geometry';
// ZONE-SNAPSHOTS ZS9 (J507): the two live interaction tables (Driftwood r12's interact constants, Pine r16's runtime table).
const tables = parse(record(string(),QuestInteractionTableSchema),{
  'driftwood-isle': parse(object({constants: object({interact: QuestInteractionTableSchema})}), liveJson('driftwood-isle', 'quests/interaction-source.json')).constants.interact,
  'pine-hollow': parse(object({table: QuestInteractionTableSchema}), liveJson('pine-hollow', 'quests/runtime.json')).table,
});

const seed = 0x1a7e, variants = new Map(), traces = {};
const add = (part, value) => {
  const key = `${part.key}:${value}`;
  if (!variants.has(key)) variants.set(key, { part, seed: value });
};
installKitProps();
for (const row of authoredPickups) registerPickupLook(row.id, { ...row,
  parts: row.parts.map(part => {
    const bound = { key: part.key, batch: part.batch, geometry: value => { add(part, value); return part.geometry(value); } };
    if ('bob' in part) bound.bob = part.bob;
    if ('pulse' in part) bound.pulse = part.pulse;
    return bound;
  }),
});
// Run the actual engine cache and seed counter; visibility and saved flags never skip construction.
for (const [name, table] of Object.entries(tables)) {
  const flags = { has: () => false }, runner = new Interactables({ flags }), rows = [], seeds = new Map();
  const original = runner.geo.bind(runner);
  runner.geo = (key, batch, make) => original(key, batch, () => {
    seeds.set(key, runner.seed); return make();
  });
  for (const def of table.rows) {
    runner.parts(new Live(def, flags));
    if (def.kind === 'pickup' || def.kind === 'altar') {
      const parts = pickupLook(def.kind === 'pickup' ? def.look : def.socketLook)?.parts ?? [];
      rows.push({ id: def.id, kind: def.kind, parts: parts.slice(0, def.kind === 'altar' ? 1 : parts.length)
        .map(part => ({ key: part.key, seed: seeds.get(part.key) })) });
    }
  }
  traces[name] = rows;
  for (const pending of runner.pending) pending.geo.dispose();
}
// Every Explorer model uses the original default seed; loot uses its independent fixed seed.
for (const row of authoredPickups) for (const part of row.parts) add(part, seed);
const coin = authoredPickups.find(row => row.id === 'coin').parts[0]; add(coin, 0xc01);
// The retained shelf bake and frozen legacy shelf use one independently coloured token per slot.
const token = authoredPickups.find(row => row.id === 'token').parts[0];
for (let i = 0; i < 8; i++) add(token, 1000 + i);

// Read-only replay of the original offline bake: every output must already exist.
const verify = (file,bytes) => {if(!Buffer.from(readFileSync(`public${file}`)).equals(bytes))throw new Error(`Pickup bake differs: ${file}`);};
const memberBytes = new Map();
let rawBytes = 0, compressedBytes = 0, legacyEncodedBytes = 0;
const geometries = [...variants.values()].map(({ part, seed: value }) => {
  const geometry = part.geometry(value), chunks = [];
  if (geometry.index !== null || geometry.groups.length > 0) throw new Error('Pickup bake requires original unindexed draws');
  const attrs = Object.entries(geometry.attributes).map(([name, attribute]) => {
    if (!(attribute.array instanceof Float32Array)) throw new Error(`Unsupported pickup attribute ${name}`);
    chunks.push(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    return [name, 'f32', attribute.itemSize, attribute.normalized];
  });
  const row = { attrs, count: geometry.getAttribute('position').count, index: null, indexCount: 0,
    box: geometry.boundingBox !== null, expand: false };
  const bytes = Buffer.concat(chunks), compressed = zlibSync(bytes), restored = readBakedGeometry(unzlibSync(compressed), 0, row);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const actual = restored.getAttribute(name).array;
    if (!Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength)
      .equals(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength))) throw new Error(`Pickup byte mismatch ${part.key}:${value}:${name}`);
  }
  if (!geometry.boundingBox.equals(restored.boundingBox) || !geometry.boundingSphere.equals(restored.boundingSphere)) throw new Error(`Pickup bounds mismatch ${part.key}:${value}`);
  rawBytes += bytes.length; compressedBytes += compressed.length; legacyEncodedBytes += Math.ceil(compressed.length/3)*4;
  geometry.dispose(); restored.dispose();
  const file = `/assets/baked/common/pickups/${createHash('sha256').update(bytes).digest('hex')}.bin`;
  verify(file,bytes);
  memberBytes.set(file, bytes);
  return { key: part.key, seed: value, geometry: row, file };
});
// Keep each original source file/identity for native and frozen readers. The
// browser's generic bank reader restores those same members from one body.
const bankBytes = Buffer.concat([...memberBytes.values()]);
const bankFile = `/assets/baked/common/pickups/${createHash('sha256').update(bankBytes).digest('hex')}.bin`;
let bankOffset = 0;
const members = [...memberBytes].map(([file, bytes]) => {
  const member = { file, offset: bankOffset, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  bankOffset += bytes.length;
  return member;
});
verify(bankFile,bankBytes);
const looks = authoredPickups.map(row => ({ id: row.id, model: row.model, name: row.name, batch: row.batch, lift: row.lift,
  parts: row.parts.map(({ geometry: _geometry, ...part }) => part) }));
const rows = { file: 'src/client/game/generators/pickups.ts', seed, coin: coin.key, geometries, looks,
  banks: [{ file: bankFile, bytes: bankBytes.length, members }] };
if(!readFileSync('src/client/game/data/pickupCatalogue.json').equals(jsonBytes(rows)))throw new Error('Pickup catalogue bytes differ');
console.log(JSON.stringify({ variants: geometries.length, rawBytes, compressedBytes, encodedBytes: 0, legacyEncodedBytes, traces }, null, 2));
