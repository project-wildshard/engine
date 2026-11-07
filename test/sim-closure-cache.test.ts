// oxlint-disable-next-line import/no-nodejs-modules -- Own only the bounded closure fixture.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths beneath repository tmp.
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { simClosure } from '../lint/sim-closure.mjs';

test('reused syntax keeps root-specific traces, current bytes and new import edges', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/sim-closure-cache-'));
  const put = (file: string, text: string): void => {
    const path = resolve(root, file);
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text);
  };
  const first = 'src/engine/sim/first.ts', second = 'src/engine/sim/second.ts';
  const bridge = 'src/engine/helpers/bridge.ts', shared = 'src/engine/helpers/shared.ts';
  try {
    put(first, `import '../helpers/shared';`);
    put(second, `import '../helpers/bridge';`);
    put(bridge, `import './shared';`);
    put(shared, 'export const value = 1;');
    expect(simClosure(root, [first])).toEqual([]);
    expect(simClosure(root, [second])).toEqual([]);
    put(shared, 'export const value = document;');
    expect(simClosure(root, [first])).toEqual([{ id: `${shared}:global:document`, count: 1, trace: [first, shared] }]);
    expect(simClosure(root, [second])).toEqual([{ id: `${shared}:global:document`, count: 1, trace: [second, bridge, shared] }]);
    put(bridge, `import './missing';`);
    expect(simClosure(root, [second])).toEqual([{ id: `${bridge}:unresolved:./missing`, count: 1, trace: [second, bridge] }]);
    put('src/engine/helpers/missing.ts', 'export const value = 1;');
    expect(simClosure(root, [second])).toEqual([]);
    put(bridge, `import type {value} from './shared';`);
    expect(simClosure(root, [second])).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
