// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without a product build.
import { readFileSync } from 'node:fs';
import ts from '@typescript/typescript6';
import * as v from 'valibot';
import type { SimValue } from '../sim';
import { ForagerContinuation } from '@wildshard/format/ambientLife';
import { expect, test } from 'vitest';

test('ambient declarations bound schema metadata and retain population entries for forest composition', () => {
  const emitted = ts.transpileDeclaration(readFileSync('node_modules/@wildshard/format/src/format/ambientLife.ts', 'utf8'), {
    fileName: 'ambientLife.ts', reportDiagnostics: true,
    compilerOptions: { isolatedDeclarations: true, strict: true, exactOptionalPropertyTypes: true },
  });
  expect(emitted.diagnostics).toEqual([]);
  expect(emitted.outputText.length).toBeLessThan(17_000);
  expect(emitted.outputText).not.toContain('SchemaWithPipe');
  expect(emitted.outputText).not.toContain('VariantSchema');
  expect(emitted.outputText).toContain('v.StrictObjectSchema<');
  expect(emitted.outputText).toContain("v.GenericSchema<ForagerPopulationRows['place']>");
  expect(emitted.outputText).toContain('v.GenericSchema<AmbientFlockData>');
});

test('the validated forager continuation remains a native simulation value', () => {
  const snapshot = v.parse(ForagerContinuation, { rows: [], acc: 0,
    rng: { version: 1, state: 1, initial: 1, scrambledFork: false },
    bands: { rates: 1, time: 0, frame: 0, frameDt: 0, rows: [] } });
  const value: SimValue = snapshot;
  expect(structuredClone(value)).toEqual(snapshot);
});
