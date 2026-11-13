import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- the guard reads the client's own source files
import { readdirSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- the guard walks the client's source tree
import { join } from 'node:path';
import { capturePointer } from '../src/client/engine/input/dom';

/** an element whose pointer is already gone, as Chrome on Android reports it */
const lifted = (name: string) => ({ setPointerCapture: () => { throw Object.assign(new Error(`Failed to execute 'setPointerCapture' on 'Element': ${name}`), { name }); } });

test('a pointer already gone is not captured and does not throw (WILDSHARD-GAME-2M)', () => {
  for (const name of ['InvalidStateError', 'NotFoundError']) expect(capturePointer(lifted(name) as unknown as Element, 7)).toBe(false);
  const taken: number[] = [];
  expect(capturePointer({ setPointerCapture: (id: number) => { taken.push(id); } } as unknown as Element, 3)).toBe(true);
  expect(taken).toEqual([3]);
});

test('every client capture goes through capturePointer', () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.ts$/u.test(entry.name) && !entry.name.endsWith('.test.ts') && !path.endsWith(join('input', 'dom.ts'))
        && /\.setPointerCapture\(/u.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
  };
  walk(join(process.cwd(), 'src/client'));
  expect(offenders).toEqual([]);
});
