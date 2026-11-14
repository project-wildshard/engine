import render from './fixtures/nalati-render-rows.json' with { type: 'json' };
import { originalSpeciesJson } from './fixtures/nalati-original-species';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { originalNalatiProductRows as nalatiProductRows } from './fixtures/nalati-product-inputs';

const original = v.parse(v.object({
  program: v.object({ script: v.object({ module: v.string(), pages: v.number() }), bytes: v.string() }),
  witnessBytes: v.number(),
}), originalSpeciesJson('species.json'));
const heldSource = v.parse(v.object({
  program: v.object({ script: v.object({ module: v.string(), pages: v.number() }), bytes: v.string(),
    v2: v.object({ artifact: v.object({ pages: v.number() }) }) }),
  compiled: v.object({ bytes: v.number() }),
}), originalSpeciesJson('species.json'));
const held = { program: heldSource.program, stealthProgram: heldSource.program,
  compiledBytes: heldSource.compiled.bytes, projectionPages: heldSource.program.v2.artifact.pages };
const product = nalatiProductRows(original, held, render);

test('witness bytes and species pages retain their separate original budget charges', () => {
  const witness = nalatiProductRows({ ...original, witnessBytes: original.witnessBytes + 7 }, held, render);
  expect(witness.serverBudget.memory - product.serverBudget.memory).toBe(7);
  expect(witness.budgets.sim.resident - product.budgets.sim.resident).toBe(7);
  expect(witness.budgets.sim.compressed - product.budgets.sim.compressed).toBe(7);
  const pages = nalatiProductRows({ ...original, program: { ...original.program, script: { ...original.program.script, pages: original.program.script.pages + 1 } } }, held, render);
  expect(pages.serverBudget.memory - product.serverBudget.memory).toBe(2 * 65536);
  expect(pages.budgets.sim.resident - product.budgets.sim.resident).toBe(2 * 65536);
  expect(pages.budgets.sim.compressed).toBe(product.budgets.sim.compressed);
  expect(pages.clientChannels).toStrictEqual(product.clientChannels);
  expect(pages.files).toStrictEqual(product.files);
});

test('original module deduplication prevents charging an existing module payload twice', () => {
  const sameModule = nalatiProductRows({ ...original, program: { ...original.program, bytes: btoa('extra') } }, held, render);
  expect(sameModule).toStrictEqual(product);
  const distinct = nalatiProductRows({ ...original, program: { ...original.program, script: { ...original.program.script, module: 'blobs/wasm/distinct.wasm' }, bytes: btoa('extra') } }, held, render);
  expect(distinct.budgets.sim.compressed - product.budgets.sim.compressed).toBe(5);
  expect(distinct.budgets.sim.resident - product.budgets.sim.resident).toBe(5);
  expect(distinct.serverBudget.memory - product.serverBudget.memory).toBe(5);
});

test('separate headers own their admitted file rows and budget storage', () => {
  const made = nalatiProductRows(original, held, render), first = made.files[0];
  if (first === undefined) throw new Error('Missing original header asset');
  first.decoded = 0;
  made.budgets.sim.resident = 0;
  const again = nalatiProductRows(original, held, render);
  expect(again).toStrictEqual(product);
});

test('invalid explicit species page and witness costs refuse before composition', () => {
  for (const witnessBytes of [-1, Number.NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => nalatiProductRows({ ...original, witnessBytes }, held, render)).toThrow('Invalid species program costs');
  for (const pages of [0, -1, Number.NaN, Infinity, 0.5])
    expect(() => nalatiProductRows({ ...original, program: { ...original.program, script: { ...original.program.script, pages } } }, held, render)).toThrow('Invalid species program costs');
});

test('explicit held inputs retain the complete original header and separate compiled/page charges', () => {
  const compiled = nalatiProductRows(original, { ...held, compiledBytes: held.compiledBytes + 7 }, render);
  expect(compiled.serverBudget.memory - product.serverBudget.memory).toBe(7);
  expect(compiled.budgets.sim.resident - product.budgets.sim.resident).toBe(7);
  expect(compiled.budgets.sim.compressed - product.budgets.sim.compressed).toBe(7);
  const pages = nalatiProductRows(original, { ...held, projectionPages: held.projectionPages + 1 }, render);
  expect(pages.serverBudget.memory - product.serverBudget.memory).toBe(2 * 65536);
  expect(pages.budgets.sim.resident - product.budgets.sim.resident).toBe(2 * 65536);
  expect(pages.budgets.sim.compressed).toBe(product.budgets.sim.compressed);
});

test('held and stealth legacy pages remain separately charged while duplicate payloads stay deduplicated', () => {
  for (const key of ['program', 'stealthProgram'] as const) {
    const program = held[key];
    const made = nalatiProductRows(original, { ...held, [key]: { ...program, script: { ...program.script, pages: program.script.pages + 1 } } }, render);
    expect(made.serverBudget.memory - product.serverBudget.memory).toBe(2 * 65536);
    expect(made.budgets.sim.resident - product.budgets.sim.resident).toBe(2 * 65536);
    expect(made.budgets.sim.compressed).toBe(product.budgets.sim.compressed);
  }
  const duplicate = nalatiProductRows(original, { ...held, stealthProgram: { ...held.stealthProgram, bytes: btoa('extra') } }, render);
  expect(duplicate).toStrictEqual(product);
  const distinct = nalatiProductRows(original, { ...held,
    program: { ...held.program, script: { ...held.program.script, module: 'blobs/wasm/held-distinct.wasm' }, bytes: btoa('extra') } }, render);
  expect(distinct.budgets.sim.compressed - product.budgets.sim.compressed).toBe(5);
  expect(distinct.budgets.sim.resident - product.budgets.sim.resident).toBe(5);
  expect(distinct.serverBudget.memory - product.serverBudget.memory).toBe(5);
});

test('invalid explicit held compiled and executable costs refuse before composition', () => {
  for (const compiledBytes of [-1, Number.NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => nalatiProductRows(original, { ...held, compiledBytes }, render)).toThrow('Invalid held program costs');
  for (const pages of [0, -1, Number.NaN, Infinity, 0.5]) {
    expect(() => nalatiProductRows(original, { ...held, projectionPages: pages }, render)).toThrow('Invalid held program costs');
    for (const key of ['program', 'stealthProgram'] as const) {
      const program = held[key];
      expect(() => nalatiProductRows(original, { ...held, [key]: { ...program, script: { ...program.script, pages } } }, render)).toThrow('Invalid held program costs');
    }
  }
});

test('render rows must be explicit and schema-admitted before header composition', () => {
  for (const invalid of [undefined, {}, { ...render, version: 2 }, { ...render, props: { version: 2 } }]) {
    expect(() => nalatiProductRows(original, held, invalid)).toThrow();
  }
});
