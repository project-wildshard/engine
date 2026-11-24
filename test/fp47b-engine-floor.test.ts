import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {checkEngineFloor, engineRelease} from '../src/cook/game/engineFloor';

// FORMAT-PRUNE FP47b (coordinator 2026-11-24, J505): SDK 0.4.31 stamps `requires.engine: 0.1.83`; a v0.1.82 grid's cook
// and pin refuse its products, so opus-road's republishes can't land on a grid that's too old.
const product = (engine?: string): Parameters<typeof checkEngineFloor>[0] => ({identity: {slug: 'nalati-grasslands'}, requires: engine === undefined ? {} : {engine}});

describe('the engine floor (FP47b)', () => {
  test('a 0.4.31-built product is refused by a v0.1.82 grid', () => {
    expect(() => { checkEngineFloor(product('0.1.83'), '0.1.82'); })
      .toThrow('This shard needs engine 0.1.83 or newer; this engine is 0.1.82 (requires.engine): nalati-grasslands');
  });
  test('v0.1.83, its next builds and later engines draw it; a product with no floor is drawn anywhere', () => {
    for (const running of ['0.1.83', '0.1.83-next.839c8ba0', '0.1.84', '0.2.0']) expect(() => { checkEngineFloor(product('0.1.83'), running); }).not.toThrow();
    expect(() => { checkEngineFloor(product(), '0.1.0'); }).not.toThrow();
  });
  test('the cook and a pin judge by this checkout\'s release', () => {
    expect(engineRelease()).toBe((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version: string}).version);
  });
});
