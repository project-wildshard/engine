// oxlint-disable-next-line import/no-nodejs-modules -- Compare every original byte and confine actual isolated producers.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Declare sealed fixture roots below repository tmp.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { build } from 'vite';
import * as v from 'valibot';
import { placeRuntimeRows, type PlaceRuntimeInput } from '../src/shards/nalati-grasslands/generators/placeRuntimeSource.mjs';
import { jsonBytes } from '../scripts/bake-output.mjs';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { assertConfigBoundary } from '../src/sharddev/configBoundary';
import { nalatiRuntimeWire } from './fixtures/nalati-runtime-wire';
import shapeBook from './fixtures/nalati-shape-book-original.json' with { type: 'json' };
import pins from './fixtures/nalati-place-runtime-files.json' with { type: 'json' };

const prefix = 'src/shards/nalati-grasslands/';
const normalize = (value: unknown): unknown => { const result: unknown = JSON.parse(new TextDecoder().decode(jsonBytes(value))); return result; };
function read(name: PlaceRuntimeInput): unknown { const path = name === 'dressing' ? 'test/fixtures/nalati-dressing-geos.json' : name === 'data/places.json' ? 'test/fixtures/nalati-places-original.json' : name === 'data/poiPaint.json' ? 'test/fixtures/nalati-poi-paint-original.json' : `${prefix}${name}`; const input: unknown = JSON.parse(readFileSync(path, 'utf8')); return input; }

test('pure runtime preparation preserves all seven complete output pins and input records', () => {
  const inputs = new Map<PlaceRuntimeInput, unknown>();
  for (const name of ['data/campCatalogue.json', 'data/places.json', 'dressing', 'data/worldView.json', 'data/modelMetrics.json', 'data/staticCapture.json', 'data/poiPaint.json'] as const) inputs.set(name, read(name));
  const select = (name: PlaceRuntimeInput): unknown => inputs.get(name);
  const before = JSON.stringify([...inputs]);
  const files = nalatiRuntimeWire(placeRuntimeRows(select, normalize));
  expect([...files.keys()].map(name => `${prefix}${name}`).sort()).toEqual(Object.keys(pins).sort());
  for (const [path, hash] of Object.entries(pins)) {
    const bytes = files.get(path.slice(prefix.length));
    if (bytes === undefined) throw new Error(`Missing original runtime output ${path}`);
    expect(hashImmutableBytes(bytes), path).toBe(hash);
    if (path.endsWith('.bin')) {
      const index = path.includes('floor-0') ? 0 : 1;
      const original = readFileSync(`test/fixtures/nalati-floor-original-${String(index)}.bin`);
      expect(hashImmutableBytes(original), path).toBe(hash);
      expect(Buffer.compare(bytes, original), path).toBe(0);
    }
  }
  expect(JSON.stringify([...inputs])).toBe(before);
});

test('structured preparation keeps metadata and independent owned floor bytes', () => {
  const first = placeRuntimeRows(read, normalize);
  expect(nalatiRuntimeWire(first).get('data/placeRuntime.generated.json')).toBeDefined();
  expect(first.metrics).toEqual(read('data/modelMetrics.json'));
  expect(first.capture).toEqual(read('data/staticCapture.json'));
  expect(first.shapeBook).toEqual(shapeBook);
  expect(first.floors.map(floor => floor.name)).toEqual(['world/floors/0.bin', 'world/floors/1.bin']);
  for (const [index, floor] of first.floors.entries()) {
    expect(Buffer.compare(floor.bytes, readFileSync(`test/fixtures/nalati-floor-original-${String(index)}.bin`))).toBe(0);
    floor.bytes.fill(0);
  }
  const second = placeRuntimeRows(read, normalize);
  for (const [index, floor] of second.floors.entries()) {
    expect(Buffer.compare(floor.bytes, readFileSync(`test/fixtures/nalati-floor-original-${String(index)}.bin`))).toBe(0);
  }
});

test('original asset and binary coverage refusals remain', () => {
  expect(() => placeRuntimeRows(name => name === 'data/campCatalogue.json' ? [] : read(name), normalize)).toThrow('Missing asset declaration');
  for (const file of ['data/places.json', 'dressing'] as const) {
    expect(() => placeRuntimeRows(name => {
      if (name !== file) return read(name);
      const row = v.parse(v.looseObject({ bytes: v.number() }), read(name));
      return { ...row, bytes: row.bytes + 4 };
    }, normalize)).toThrow('rows do not cover their binary');
  }
  expect(() => placeRuntimeRows(name => name === 'data/modelMetrics.json' ? new Uint8Array([1]) : read(name), normalize)).toThrow('BINARY-JSON');
});

test('the preparation source bundles as one config-safe chunk', async () => {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: resolve(`${prefix}generators/placeRuntimeSource.mjs`), formats: ['es'] },
    rolldownOptions: { external: [/^node:/u], output: { codeSplitting: false } },
  } });
  const built = Array.isArray(result) ? result[0] : result;
  if (built === undefined || !('output' in built)) throw new Error('Missing runtime preparation bundle');
  const chunks = built.output.filter(row => row.type === 'chunk'); expect(chunks).toHaveLength(1);
  for (const chunk of chunks) {
    expect(() => assertConfigBoundary([...chunk.imports, ...chunk.dynamicImports])).not.toThrow();
    expect([...chunk.imports, ...chunk.dynamicImports]).toEqual([]);
  }
});
