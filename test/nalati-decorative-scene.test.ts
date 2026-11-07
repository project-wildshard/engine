import { nalatiSpecimens } from './fixtures/nalati-specimens';
import { nalatiBalbal } from './fixtures/nalati-balbal';
import { nalatiRuntime } from './fixtures/nalati-runtime';
import { nalatiDecorative } from './fixtures/nalati-decorative';
import { expect, test } from 'vitest';
import { dressingScene, dressingSceneBlobs as namedDressingSceneBlobs } from './fixtures/nalati-dressing-scene';
import {originalDressingContactTransport} from './fixtures/nalati-contact-transport';
import * as v from 'valibot';
import { sceneWithNativeOutcrops } from './fixtures/nalati-scene-provenance';

function dressingSceneBlobs(...args:Parameters<typeof namedDressingSceneBlobs>):ReturnType<typeof namedDressingSceneBlobs>{
  return originalDressingContactTransport(namedDressingSceneBlobs(...args),new Map((['phone','desktop']as const)
    .map(tier=>[`world/dressing-${tier}.json`,dressingScene(tier,args[0],args[1],args[2],args[3])])));
}

test('the two observed Linux outcrop input values reconstruct both complete scene wires exactly', () => {
  const source = v.parse(v.looseObject({ places: v.looseObject({ rows: v.array(v.looseObject({
    name: v.string(), members: v.array(v.tuple([v.string(), v.unknown()])),
  })) }) }), structuredClone(nalatiRuntime));
  const row = source.places.rows.find(value => value.name === 'outcrops'), pair = row?.members[0];
  if (row === undefined || pair === undefined) throw new Error('Missing original outcrop member');
  const member = v.parse(v.looseObject({ boxes: v.array(v.number()), solid: v.array(v.unknown()), descs: v.array(v.unknown()) }), pair[1]);
  expect(member.boxes[1113]).toBe(-243.679218795643);
  member.boxes[1113] = -243.67921879564298;
  const contacts = [...member.solid, ...member.descs];
  const contact = v.parse(v.looseObject({ z: v.number() }), contacts[166]);
  expect(contact.z).toBe(-15.97741638745246);
  contact.z = -15.977416387452461;
  if (member.solid.length > 166) member.solid[166] = contact;
  else member.descs[166 - member.solid.length] = contact;
  row.members[0] = [pair[0], member];
  const compiled = dressingSceneBlobs(nalatiDecorative, source,nalatiBalbal,nalatiSpecimens);
  for (const tier of ['phone', 'desktop']) {
    const name = `world/dressing-${tier}.json`;
    const frozen = dressingSceneBlobs(nalatiDecorative, nalatiRuntime,nalatiBalbal,nalatiSpecimens).find(blob => blob.file.name === name);
    const actual = compiled.find(blob => blob.file.name === name);
    if (frozen === undefined || actual === undefined) throw new Error('Missing complete dressing wire');
    const projected = sceneWithNativeOutcrops(frozen, source);
    expect(projected.file).toEqual(actual.file);
    expect(Buffer.compare(projected.bytes, actual.bytes)).toBe(0);
    expect(() => sceneWithNativeOutcrops(frozen, {})).toThrow();
  }
});

test('supplied incomplete decorative profiles refuse without falling back to the retained copy', () => {
  expect(() => dressingSceneBlobs({},nalatiRuntime,nalatiBalbal,nalatiSpecimens)).toThrow();
  expect(() => dressingSceneBlobs({ phone: {}, desktop: {} },nalatiRuntime,nalatiBalbal,nalatiSpecimens)).toThrow();
  expect(() => dressingSceneBlobs(null,nalatiRuntime,nalatiBalbal,nalatiSpecimens)).toThrow();
  expect(() => dressingSceneBlobs(undefined,nalatiRuntime,nalatiBalbal,nalatiSpecimens)).toThrow();
});

test('missing or malformed supplied runtime metadata refuses without a retained fallback', () => {
  for (const runtime of [undefined, null, {}, { places: { rows: [] } }]) {
    expect(() => dressingSceneBlobs(nalatiDecorative, runtime,nalatiBalbal,nalatiSpecimens)).toThrow();
  }
});

test('supplied place addresses drive both tier wires without mutating their source', () => {
  const beforeRuntime = JSON.stringify(nalatiRuntime);
  const input = v.parse(v.looseObject({ places: v.looseObject({ rows: v.array(v.looseObject({
    name: v.string(), meshes: v.array(v.looseObject({ offset: v.number() })),
  })) }) }), structuredClone(nalatiRuntime));
  const mesh = input.places.rows.find(row => row.name === 'camp')?.meshes[0];
  if (mesh === undefined) throw new Error('Missing native camp mesh');
  mesh.offset += 4;
  const before = JSON.stringify(input), blobs = dressingSceneBlobs(nalatiDecorative, input,nalatiBalbal,nalatiSpecimens);
  for (const tier of ['phone', 'desktop'] as const) {
    const geometry = dressingScene(tier, nalatiDecorative, input,nalatiBalbal,nalatiSpecimens).geometry['camp.0'];
    if (geometry?.kind !== 'baked-file') throw new Error('Missing supplied camp geometry');
    const bytes = blobs.find(blob => blob.file.name === geometry.address.file)?.bytes;
    if (bytes === undefined) throw new Error('Missing supplied camp address bytes');
    expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(geometry.address.word * 4, true)).toBe(mesh.offset);
  }
  expect(JSON.stringify(input)).toBe(before);
  expect(JSON.stringify(nalatiRuntime)).toBe(beforeRuntime);
});

test('scene construction requires the supplied balbal catalogue and encounter owner', () => {
  expect(() => dressingSceneBlobs(nalatiDecorative, nalatiRuntime, undefined,nalatiSpecimens)).toThrow();
  expect(() => dressingSceneBlobs(nalatiDecorative, nalatiRuntime, {},nalatiSpecimens)).toThrow();
  const supplied = structuredClone(nalatiBalbal);
  supplied.generated.transform.scale = 7;
  const scene = dressingScene('phone', nalatiDecorative, nalatiRuntime, supplied,nalatiSpecimens);
  expect(scene.sites[0]?.rows.generated?.transform?.scale).toBe(7);
  expect(nalatiBalbal.generated.transform.scale).not.toBe(7);
});

test('scene compilation requires supplied specimen ownership and retains its packed byte count', () => {
  for (const supplied of [undefined, {}]) expect(() => dressingSceneBlobs(nalatiDecorative, nalatiRuntime, nalatiBalbal, supplied)).toThrow();
  const supplied = structuredClone(nalatiSpecimens);
  supplied.packed.bytes += 4;
  const scene = dressingScene('phone', nalatiDecorative, nalatiRuntime, nalatiBalbal, supplied);
  const catalogue = scene.catalogues[0];
  if (catalogue === undefined || !('packed' in catalogue)) throw new Error('Missing supplied packed specimen catalogue');
  expect(catalogue.packed?.bytes).toBe(supplied.packed.bytes);
  expect(nalatiSpecimens.packed.bytes).not.toBe(supplied.packed.bytes);
});
