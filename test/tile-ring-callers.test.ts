// oxlint-disable-next-line import/no-nodejs-modules -- Read each tile driver caller's shipped source.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- List the game layer's sources from the checkout.
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, expect, test } from 'vitest';
import ts from '@typescript/typescript6';
import { folderTileRing } from '../src/client/game/shardfile/tileDriver';
import { CELL_RING } from '../src/client/game/shardfile/tileContent';
import { jsonSlot } from '../src/client/engine/saves/slots';
import { LEVEL_DOWNLOAD_SLOT, runtimePacksOn } from '../src/client/engine/boot/loadingPacks';

const download = jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device'), previous = download.read();
beforeAll(() => { download.write('shardfile'); expect(runtimePacksOn()).toBe(false); });
afterAll(() => { download.write(previous); });

// NT1: a driver started without its product's ring falls back to the device's 5 x 5, so Nine's `ring: 'cell'` held only
// 5 of 25 fabric unions from the west deck. Every caller hands residentTiles the product's own ring.
test('every residentTiles caller passes its product ring', () => {
  const files = execFileSync('git', ['ls-files', 'src/*/game/*'], { encoding: 'utf8' }).split('\n').filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('tileDriver.ts'));
  const calls = files.flatMap(file => residentTileCalls(file, readFileSync(file, 'utf8')));
  expect(calls.length).toBeGreaterThanOrEqual(4);
  for (const [file, args] of calls) expect(`${file}: ${args}`).toMatch(/folderTileRing\(\w+\)$/u);
});


/** Include direct and instrumentation-wrapped calls without parsing nested
 * argument lists with a regex. The same product-ring assertion owns every call. */
function residentTileCalls(file: string, text: string): (readonly [string, string])[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), calls: (readonly [string, string])[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'residentTiles')
      calls.push([file, node.arguments.map(argument => argument.getText(source)).join(', ')]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

test('ring census includes wrapped calls and still exposes a missing product ring', () => {
  for (const ring of ['folderTileRing(source)', 'deviceRing']) {
    const calls = residentTileCalls('wrapped.ts', `await measure('tiles', () => residentTiles(owner, scenes.tiled(), source.spawn, source.entryways, ${ring}));`);
    expect(calls).toHaveLength(1);
    const call = calls[0]; if (call === undefined) throw new Error('Missing wrapped tile call');
    expect(/folderTileRing\(\w+\)$/u.test(call[1])).toBe(ring === 'folderTileRing(source)');
  }
});

test('a product declaring its whole cell drives the whole cell; others keep the device ring', () => {
  expect(folderTileRing({ ring: 'cell' })()).toBe(CELL_RING);
  expect(folderTileRing({})()).toBeLessThan(CELL_RING);
});
