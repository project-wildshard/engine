import { expect, test } from 'vitest';
import * as eager from 'valibot';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the installed valibot dist the client build transforms.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed dist and the fixture module.
import { createRequire } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Import the transformed fixture by file URL.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Import the transformed fixture by file URL.
import { pathToFileURL } from 'node:url';
import { EAGER_STANDARD, lazyValibotStandard } from '../vite/valibotStandard';

const dist = createRequire(import.meta.url).resolve('valibot').replace(/index\.(?:c?js|mjs)$/u, 'index.mjs');

test('DF11: lazy ~standard keeps every schema parse and Standard Schema result the same', async () => {
  const source = readFileSync(dist, 'utf8');
  const lazySource = lazyValibotStandard(source, dist);
  expect(lazySource).not.toBeNull();
  expect(lazySource).not.toContain(EAGER_STANDARD);
  mkdirSync('tmp/valibot-lazy-standard', { recursive: true });
  const root = mkdtempSync(resolve('tmp/valibot-lazy-standard/run-'));
  try {
    const file = join(root, 'index.mjs');
    writeFileSync(file, lazySource ?? '');
    const lazy = (await import(pathToFileURL(file).href)) as typeof eager;
    const build = (v: typeof eager) => v.strictObject({
      id: v.pipe(v.string(), v.minLength(1), v.maxLength(8)), count: v.pipe(v.number(), v.integer(), v.minValue(0)),
      tags: v.array(v.picklist(['a', 'b'])), mode: v.exactOptional(v.union([v.literal('x'), v.null()])),
      nested: v.object({ at: v.tuple([v.number(), v.number()]) }),
    });
    const a = build(eager), b = build(lazy);
    const inputs: unknown[] = [
      { id: 'one', count: 2, tags: ['a'], nested: { at: [1, 2] } }, { id: '', count: 2, tags: [], nested: { at: [1, 2] } },
      { id: 'toolongname', count: -1, tags: ['c'], mode: 'y', nested: { at: [1] } }, { id: 'x', count: 1.5, tags: [], nested: { at: [0, 0] }, extra: 1 },
      null, 'text', { id: 'ok', count: 0, tags: ['b', 'a'], mode: null, nested: { at: [3, 4] } },
    ];
    for (const input of inputs) {
      expect(JSON.stringify(lazy.safeParse(b, input))).toBe(JSON.stringify(eager.safeParse(a, input)));
      expect(JSON.stringify(b['~standard'].validate(input))).toBe(JSON.stringify(a['~standard'].validate(input)));
    }
    // Same props on demand, then a plain data property; spreads and key walks no longer copy or list them.
    const fresh = lazy.string();
    expect(Object.keys(fresh)).not.toContain('~standard');
    expect(Object.getOwnPropertyDescriptor(fresh, '~standard')).toBeUndefined();
    expect(Object.getPrototypeOf(lazy.string())).toBe(Object.getPrototypeOf(lazy.number()));
    expect({ ...lazy.pipe(lazy.string(), lazy.minLength(1)) }).not.toHaveProperty('~standard', expect.anything());
    expect({ version: fresh['~standard'].version, vendor: fresh['~standard'].vendor }).toEqual({ version: 1, vendor: 'valibot' });
    expect(Object.getOwnPropertyDescriptor(fresh, '~standard')?.value).toBe(fresh['~standard']);
    const assigned = lazy.number(), replacement = { version: 1 as const, vendor: 'other', validate: () => ({ value: 0 }) };
    Reflect.set(assigned, '~standard', replacement);
    expect(assigned['~standard']).toBe(replacement);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('DF11: a valibot whose _standardSchema changed fails the build instead of keeping the eager glue', () => {
  expect(() => lazyValibotStandard('export const x = 1;', '/n/node_modules/valibot/dist/index.mjs')).toThrow("valibot's _standardSchema changed");
  expect(lazyValibotStandard(EAGER_STANDARD, '/n/node_modules/other/dist/index.mjs')).toBeNull();
});
