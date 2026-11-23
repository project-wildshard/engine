// SHARD-COMPAT SP1b5a: the record job's `prepare` port runs `wildshard prepare <folder>` with only PATH, a scratch HOME
// and this engine's preparation client, and turns a failure or a deadline into the recorder's last line.
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its folders.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Folders under the repository's tmp/.
import {join, resolve} from 'node:path';
import {afterAll, expect, test} from 'vitest';
import {wildshardPrepare} from '../src/cook/game/sidecarPrepare';

mkdirSync('tmp/sidecar-prepare', {recursive: true});
const root = mkdtempSync(resolve('tmp/sidecar-prepare/run-'));
afterAll(() => { rmSync(root, {recursive: true, force: true}); });
/** A stand-in `wildshard`: `node -e <script> -- prepare <folder>`. */
const recorder = (script: string, seconds = 20): ReturnType<typeof wildshardPrepare> =>
  wildshardPrepare({command: [process.execPath, '-e', script, '--'], client: '/the/preparation/client', wrap: [], seconds});
const folder = (name: string): string => { const at = join(root, name); mkdirSync(at); return at; };
const SEES = [
  "const [verb, dir] = process.argv.slice(-2);",
  "require('node:fs').writeFileSync(require('node:path').join(dir, 'seen.json'), JSON.stringify({verb,",
  "  client: process.env.WILDSHARD_PREPARATION_CLIENT, home: process.env.HOME, secret: process.env.WILDSHARD_SECRET_FOR_TEST ?? null}));",
].join('\n');

test('the recorder sees its folder, the client and a scratch home, and nothing else of this process', async () => {
  process.env['WILDSHARD_SECRET_FOR_TEST'] = 'never passed on';
  const at = folder('sees');
  try { await recorder(SEES)(at); } finally { delete process.env['WILDSHARD_SECRET_FOR_TEST']; }
  expect(JSON.parse(readFileSync(join(at, 'seen.json'), 'utf8'))).toEqual({verb: 'prepare', client: '/the/preparation/client', home: `${at}-home`, secret: null});
  expect(existsSync(`${at}-home`)).toBe(false);
});

test('a recorder that fails or overruns rejects with its last line', async () => {
  await expect(recorder("console.error('headless WebKit did not start'); process.exit(2);")(folder('fails'))).rejects.toThrow('wildshard prepare exit 2: headless WebKit did not start');
  await expect(recorder("console.log('recording'); setTimeout(() => {}, 60_000);", 1)(folder('slow'))).rejects.toThrow('wildshard prepare past 1 s (SIGKILL): recording');
});
