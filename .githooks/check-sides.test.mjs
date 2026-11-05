import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { checkSides } from '../src/scripts/check-sides.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'sides-'));
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), code);
  }
  return root;
}

describe('check-sides', () => {
  test('allows each side its own folder and shared', () => {
    const src = tree({
      'shared/tick.ts': "export const T = 1\n",
      'server/room.ts': "import { T } from '../shared/tick.ts'\nimport { R } from './rules.ts'\n",
      'server/rules.ts': 'export const R = 1\n',
      'client/view.ts': "import { T } from '../shared/tick.ts'\n",
      'cook/pack.ts': "import { T } from '../shared/tick.ts'\n",
    });
    assert.deepEqual(checkSides(src), []);
  });

  test('refuses client to server, server to client and shared upward', () => {
    const src = tree({
      'shared/tick.ts': "import { V } from '../client/view.ts'\n",
      'server/room.ts': "export { V } from '../client/view.ts'\n",
      'client/view.ts': "const r = await import('../server/room.ts')\nexport const V = r\n",
      'cook/pack.ts': "import '../client/view.ts'\n",
    });
    const problems = checkSides(src).sort();
    assert.equal(problems.length, 4);
    assert.match(problems.join('\n'), /client\/view\.ts: client imports server/);
    assert.match(problems.join('\n'), /server\/room\.ts: server imports client/);
    assert.match(problems.join('\n'), /shared\/tick\.ts: shared imports client/);
    assert.match(problems.join('\n'), /cook\/pack\.ts: cook imports client/);
  });

  test('ignores packages and folders outside the four sides', () => {
    const src = tree({
      'client/view.ts': "import { x } from 'three'\nimport { y } from '../cli/version.ts'\n",
    });
    assert.deepEqual(checkSides(src), []);
  });
});
