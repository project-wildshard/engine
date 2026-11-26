// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only its temporary build outputs under ./tmp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths under ./tmp.
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { checkOneThree, pageScripts, threeCopies } from '../src/scripts/app-build/oneThree.mjs';
import { writeStandaloneOutput } from '../src/scripts/app-build/standaloneOutput.mjs';

const THREE = 'if(window.__THREE__)console.warn("Multiple instances");else window.__THREE__="186";';

/** A scratch out dir under ./tmp, removed after `body`. */
async function outDir(prefix: string, body: (root: string, put: (file: string, text: string) => void) => Promise<void> | void): Promise<void> {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve(`tmp/${prefix}-`));
  const put = (file: string, text: string): void => { const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); };
  try { await body(root, put); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('QA 11-25 row 137: a second three.js among a page\'s scripts fails the build, a worker\'s copy does not count', async () => {
  await outDir('one-three', (root, put) => {
    put('.vite/manifest.json', JSON.stringify({ 'index.html': { file: 'b/1/main.js', isEntry: true }, '_s': { file: 'b/c/session-real.js' } }));
    put('index.html', '<html><head><script type="importmap">{"imports":{"/b/c/session-key.js":"/b/c/session-real.js"}}</script>'
      + '<script type="module" src="/b/1/main.js"></script></head></html>');
    put('b/1/main.js', 'import("../c/session-key.js");');
    put('b/c/session-real.js', THREE);
    // the online shell, loaded by URL at runtime, with its own copy in a shared chunk (v0.1.92's standalone/config-*.js)
    put('b/1/standalone/online.js', 'import "./config-x.js";');
    put('b/1/standalone/config-x.js', THREE);
    // a worker the shell starts by URL runs apart from the page: never followed, never counted
    put('b/1/standalone/serverWorker-x.js', THREE);
    expect(pageScripts(root, '1')).toEqual(['b/1/main.js', 'b/1/standalone/config-x.js', 'b/1/standalone/online.js', 'b/c/session-real.js']);
    expect(() => checkOneThree(root, '1')).toThrow('A page loads 2 copies of three.js (QA 11-25 row 137): b/1/standalone/config-x.js, b/c/session-real.js');
    put('b/1/standalone/config-x.js', 'export const config = 1;');
    expect(checkOneThree(root, '1')).toEqual({ copies: 1 });
  });
});

test('QA 11-25 row 137: the online shell\'s real bundle holds no three.js, so the session\'s copy is the page\'s only one', async () => {
  await outDir('one-three-shell', async (root, put) => {
    put('.vite/manifest.json', '{}');
    await writeStandaloneOutput(root, 'shell', process.cwd());
    expect(pageScripts(root, 'shell')).toContain('b/shell/standalone/online.js');
    expect(threeCopies(root, 'shell')).toEqual([]);
  });
}, 60_000);
