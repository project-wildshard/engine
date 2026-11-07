// oxlint-disable-next-line import/no-nodejs-modules -- Own bounded author fixtures under the repository scratch root.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only owned author and output paths.
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { runCli } from '../src/sharddev/cli';
import { shardfileValidationRevision } from '../scripts/shardfile-validation-revision.mjs';

/** An author outside this tree (SD-1, SD-21): no lockfile and no `public/`, and an error must say where. Each runs the
 *  real CLI on one scaffolded project. */
let scratch = '', project = '';
const output = (text: string): void => { writeFileSync(resolve(project, 'generators/output.ts'), text); };
const sections = (rows: string): string => `import { emitPlatformSections } from '@wildshard/sharddev/platformSections';\nexport const output = { platform: emitPlatformSections(new Map([${rows}])) };\n`;
const build = async (...flags: readonly string[]): Promise<void> => { await runCli(['build', project, resolve(scratch, 'out'), '--product-only', ...flags]); };

beforeAll(async () => {
  mkdirSync('tmp', { recursive: true });
  scratch = mkdtempSync(resolve('tmp', 'author-errors-'));
  project = resolve(scratch, 'my-isle');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  await runCli(['new', project, 'my-isle']);
});
afterAll(() => { vi.restoreAllMocks(); rmSync(scratch, { recursive: true, force: true }); });

test('a folder with no lockfile takes the tools\' validation revision', () => {
  const empty = mkdtempSync(resolve(scratch, 'empty-'));

  expect(shardfileValidationRevision(empty)).toBe(shardfileValidationRevision());
});

test('a project with no public/ builds', async () => {
  output(sections(''));
  const manifest = { folder: 'my-isle', imageRoots: [{ prefix: '/assets/', directory: resolve(scratch, 'public/assets') }] };

  await expect(runCli(['build', project, resolve(scratch, 'out'), '--product-only'], { manifest })).resolves.toBeUndefined();
});

test('a bad row names its section and field', async () => {
  output(sections(`['actors/moves', [{ id: 'my-isle.walk', kind: 'stalk', speed: 'fast', turn: 4, ground: true, above: 0, standOff: 0, ready: { kind: 'range' } }]]`));

  const error = await build().catch((caught: unknown) => caught);

  expect(String(error)).toContain('actors/moves');
  expect(String(error)).toContain('[0].speed');
  expect(String(error)).toContain('"fast"');
});

test('a misspelt section is named', async () => {
  output(sections(`['actors/mooves', []]`));

  await expect(build()).rejects.toThrow('actors/mooves');
});

test('a bad top-level field is named', async () => {
  output('export const output = {};\n');
  writeFileSync(resolve(project, 'data/world.ts'), `import { emptyShardfile } from '@wildshard/engine/host/author';\nimport { IDENTITY } from './card';\n\nexport const WORLD = { ...emptyShardfile(IDENTITY), identity: 'here' };\n`);

  await expect(build()).rejects.toThrow('identity');
});

test('a misspelt build flag is named', async () => {
  await expect(build('--no-placeholder')).rejects.toThrow('--no-placeholder');
});
