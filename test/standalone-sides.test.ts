// oxlint-disable-next-line import/no-nodejs-modules -- Reads the source graph, as the sides census does.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseSync } from 'vite';
import { importCandidates, readSides, sideFacts, SIDES_FILE } from '../lint/engine-sides.mjs';

// P1-E5.2 (J2, J31): the sides lint rejects a direct edge; this walks the real import graph, so the page half reaches no
// `server` module even by a chain, and the shipped entry reaches no standalone module, because nothing switches the client
// onto the worker until E5.4.

const sides = readSides(JSON.parse(readFileSync(SIDES_FILE, 'utf8')));
/** Every source file `entry` reaches through value imports. */
function closure(entry: string): Set<string> {
  const seen = new Set<string>(), queue = [entry];
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (seen.has(path)) continue;
    seen.add(path);
    const { program } = parseSync(path, readFileSync(path, 'utf8'));
    for (const { source } of sideFacts(program).imports) {
      const target = importCandidates(path, source).find(candidate => existsSync(candidate) && /\.[cm]?[jt]s$/u.test(candidate));
      if (target !== undefined) queue.push(target);
    }
  }
  return seen;
}

test('the page half of the standalone target reaches no server code', () => {
  const reached = closure('src/client/host/standalone/shell.ts');
  expect(reached.has('src/client/engine/net/client.ts')).toBe(true);
  expect([...reached].filter(path => sides.get(path)?.side === 'server')).toEqual([]);
});

// J130: a Developer row runs the worker client, so the page reaches the client half of the wire. The server half stays out.
test('the shipped client does not reach the standalone target or the server wire', () => {
  const reached = closure('src/client/app/entry.ts');
  expect(reached.size).toBeGreaterThan(100);
  expect([...reached].filter(path => path.includes('/standalone/') || path.startsWith('src/server/engine/net/'))).toEqual([]);
});
