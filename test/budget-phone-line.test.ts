// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the source tree for the one copy of the line.
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { capFor, readCaps } from '../src/scripts/budgets/files.mjs';
import { PHONE_MEMORY_LOADING_CAP_BYTES } from '../src/shared/engine/core/phoneMemoryCap';
import { MEMORY_AMBER } from '../src/client/game/grid/budgetOverlay';
import { PHONE_MEMORY_LINE_BYTES } from '../src/client/game/shardfile/phoneMemoryLine';

// BUDGET-CAPS BC12: engine's phone memory line is written once, from budgets/caps.json.
test('the engine phone line is caps.json memory/loading/* hard cap, and both client readers use it', () => {
  expect(PHONE_MEMORY_LOADING_CAP_BYTES).toBe(capFor(readCaps(), 'memory/loading/any')?.hard);
  expect(MEMORY_AMBER).toBe(PHONE_MEMORY_LOADING_CAP_BYTES);
  expect(PHONE_MEMORY_LINE_BYTES).toBe(PHONE_MEMORY_LOADING_CAP_BYTES);
});

test('1.5e9 is written once in src/client and src/shared engine code, outside tests', () => {
  const hits = (['src/client', 'src/shared'] as const).flatMap(root => readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.generated.ts'))
    .filter(file => readFileSync(`${root}/${file}`, 'utf8').includes('1.5e9')).map(file => `${root}/${file}`));
  expect(hits).toEqual(['src/shared/engine/core/phoneMemoryCap.ts']);
});
