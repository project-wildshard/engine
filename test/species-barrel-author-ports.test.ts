// oxlint-disable-next-line import/no-nodejs-modules -- Verify metadata admission in a fresh renderer-guarded native realm.
import { execFileSync } from 'node:child_process';
import { expect, expectTypeOf, test } from 'vitest';
import * as v from 'valibot';
import { speciesFieldReader } from '../src/sharddev/species';
import { puzzleBarrelBody } from '../src/sharddev/bake/nativeInteractionFacts';
import { SpeciesSchema } from '@wildshard/format/speciesPrograms';
import { BARREL_BODY, BARREL_HALF } from '../src/shared/engine/world/interact/barrel';
import { speciesBarrelAuthorObservation } from './fixtures/species-barrel-author-observation';
import original from './fixtures/species-barrel-author-original.json' with { type: 'json' };

function outcome(run: () => unknown): unknown {
  try { return { rows: run() }; }
  catch (error) { if (error instanceof v.ValiError) return { issues: error.issues }; throw error; }
}

test('finite species-field readers retain complete defining types, strict grammar and issue order', () => {
  const fields = ['aggressive', 'walkSpeed', 'chargeSpeed', 'chargeDamage', 'sounds', 'tuning', 'tick', 'trampleRadius'] as const;
  const schema = v.pick(SpeciesSchema, fields), read = speciesFieldReader(fields);
  expectTypeOf<ReturnType<typeof read>>().toEqualTypeOf<v.InferOutput<typeof schema>>();
  for (const value of [{}, { aggressive: true, walkSpeed: 2, tick: 'ai' }, null,
    { walkSpeed: 'fast', tick: 'later' }, { extra: 1 }, { sounds: null }, { tuning: { hp: 'bad' } }]) {
    expect(outcome(() => read(value))).toEqual(outcome(() => v.parse(schema, value)));
  }
  const identity = speciesFieldReader(['id', 'kind', 'label']);
  expect(identity({ id: 'orchard.bee', kind: 'bee', label: 'Bee' })).toEqual({ id: 'orchard.bee', kind: 'bee', label: 'Bee' });
  expect(() => identity({ id: 'orchard.bee', kind: 'bee', label: 'Bee', tick: 'ai' })).toThrow();
});

test('barrel metadata preserves native complete identity and stays renderer-free', () => {
  expectTypeOf<ReturnType<typeof puzzleBarrelBody>>().toEqualTypeOf<typeof BARREL_BODY>();
  expect(puzzleBarrelBody()).toBe(BARREL_BODY);
  expect(puzzleBarrelBody().shape.cylinder.halfHeight).toBe(BARREL_HALF);
  const code = "import {puzzleBarrelBody} from './src/sharddev/bake/nativeInteractionFacts.ts'; console.log(JSON.stringify(puzzleBarrelBody()));";
  const result = execFileSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/sim-node-loader.mjs', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000 });
  expect(JSON.parse(result)).toEqual(BARREL_BODY);
});

test('complete ecology, barrel bodies/floors and watch decision retain original wires', () => {
  expect(speciesBarrelAuthorObservation()).toEqual(original);
});
