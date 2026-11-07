import { expect, test } from 'vitest';
import * as v from 'valibot';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin the complete approved original named document.
import { createHash } from 'node:crypto';
import { SpeciesActorsFileSchema } from '@wildshard/format/speciesActorsFile';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { ReturnProgramWireDocumentSchema } from '@wildshard/format/returnProgramDocument';
import { ReturnProjectionV2Schema } from '@wildshard/format/returnProjectionV2';
import { namedJsonSchema, registeredJsonSchema } from '../src/shared/host/formatJsonSchema';
import { platformFileFamily, validatePlatformFile } from '@wildshard/format/platformFileFamilies';
import { nameBlob } from '../src/sharddev/blobs';
import { encodeCanonicalJson } from '../src/shared/host/immutable';
import fixture from './fixtures/approved-sheep-root.json' with { type: 'json' };

const name = 'actors/sheep.json';
const source = '@wildshard/format/speciesActorsFile#SpeciesActorsFileSchema';
const raw = new TextEncoder().encode(fixture.body);

test('the complete sheep file retains original native, decoded and canonical wire identity', () => {
  const input: unknown = JSON.parse(fixture.body), before = JSON.stringify(input);
  const result = v.parse(SpeciesActorsFileSchema, input);
  expect(raw.byteLength).toBe(108205);
  expect(createHash('sha256').update(raw).digest('hex')).toBe('d86a90e95f80713ff119785b5aa854a0c2123aa047efd55a399def7757b5f8e1');
  expect(result).toEqual(input);
  expect(encodeCanonicalJson(result)).toBe(fixture.body);
  expect(JSON.stringify(input)).toBe(before);
  const document = registeredJsonSchema(name), family = platformFileFamily(name, source);
  if (document === undefined || family === undefined) throw new Error('Missing complete sheep contract');
  expect(document['$comment']).toBe(source);
  expect(family.schema).toBe(SpeciesActorsFileSchema);
  expect(validatePlatformFile(name, source, input)).toBe(family);
  expect(nameBlob(name, 'json', raw, { jsonSchema: document }).bytes).toEqual(raw);
  expect(platformFileFamily(name, `${source}Other`)).toBeUndefined();
  expect(platformFileFamily(`private/${name}`, source)).toBeUndefined();
  expect(platformFileFamily('actors/sheep-copy.json', source)).toBeUndefined();
});

test('both sheep page modes, pose fields, skeletons and complete guests refuse incomplete children', () => {
  const input = v.parse(SpeciesActorsFileSchema, JSON.parse(fixture.body));
  const first = Object.keys(input.species.poses)[0], skeleton = input.species.packedBodies.skeletons[0];
  if (first === undefined || skeleton === undefined) throw new Error('Missing original pose or skeleton');
  const document = registeredJsonSchema(name);
  for (const value of [
    { ...input, foreign: true },
    { ...input, page: { ...input.page, world: null } },
    { ...input, page: { ...input.page, specimen: { ...input.page.specimen, view: { ...input.page.specimen.view, motion: {} } } } },
    { ...input, species: { ...input.species, poses: { ...input.species.poses, [first]: {} } } },
    { ...input, species: { ...input.species, packedBodies: { ...input.species.packedBodies, skeletons: [{ ...skeleton, bones: [{ name: 'root', parent: 0, pos: [0, 0, 0] }] }] } } },
    { ...input, species: { ...input.species, guest: { ...input.species.guest, program: { ...input.species.guest.program, script: null } } } },
    { ...input, species: { ...input.species, lookBook: { ...input.species.lookBook, program: { ...input.species.lookBook.program, script: null } } } },
  ]) {
    expect(() => v.parse(SpeciesActorsFileSchema, value)).toThrow();
    expect(() => nameBlob(name, 'json', new TextEncoder().encode(JSON.stringify(value)), { jsonSchema: document })).toThrow();
  }
});

test('factored sheep metadata retains the complete original return grammars', () => {
  const document = registeredJsonSchema(name);
  const object = v.record(v.string(), v.unknown());
  const structure = (schema: Readonly<Record<string, unknown>>): Record<string, unknown> => {
    const { $schema: _schema, ...body } = schema;
    return body;
  };
  const legacy = structure(namedJsonSchema(ReturnProgramSchema));
  const wire = structure(namedJsonSchema(ReturnProgramWireDocumentSchema));
  expect(document['definitions']).toEqual({
    legacyReturn: { ...legacy, properties: { ...v.parse(object, legacy['properties']), v2: { $ref: '#/definitions/projection' } } },
    wireReturn: { ...wire, properties: { ...v.parse(object, wire['properties']), v2: { $ref: '#/definitions/projection' } } },
    projection: structure(namedJsonSchema(ReturnProjectionV2Schema)),
  });
});

test('unsafe sheep inputs refuse before any accessor is read', () => {
  let reads = 0;
  const input: unknown = { get species() { reads++; return {}; } };
  expect(v.safeParse(SpeciesActorsFileSchema, input).success).toBe(false);
  expect(reads).toBe(0);
});
