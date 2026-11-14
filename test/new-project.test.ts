// oxlint-disable-next-line import/no-nodejs-modules -- Own bounded author fixtures under the repository scratch root.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only owned author and output paths.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { buildProject } from '@wildshard/sharddev/project';
import { validateOutputFolder } from '@wildshard/sharddev/outputFolder';
import { writeNewProject } from '../src/sharddev/newProject';
import { runCli } from '../src/sharddev/cli';
import { checkShardLayout } from '../scripts/check-shards.mjs';
import layout from '../lint/shard-layout.json';

test('new projects build v2 from build-only data without a custom runtime', async () => {
  mkdirSync('tmp', { recursive: true });
  const scratch = mkdtempSync(resolve('tmp', 'template-layout-'));
  try {
    const project = resolve(scratch, 'new-world'), output = resolve(scratch, 'output');
    await runCli(['new', project, 'new-world']);
    expect(readdirSync(project).sort()).toEqual(['README.md', 'assets', 'behaviour', 'data', 'generators', 'shard.config.ts']);
    expect(readdirSync(resolve(project, 'generators')).sort()).toEqual(['output.ts', 'product.ts']);
    expect(() => writeNewProject(project, 'new-world')).toThrow('fresh directory');
    expect(checkShardLayout({ 'new-world': ['README.md', 'assets/', 'behaviour/', 'data/', 'generators/', 'shard.config.ts'] }, layout)).toEqual([]);
    // Add a real platform row through the generated sidecar, as an author would.
    writeFileSync(resolve(project, 'generators/output.ts'), `import { emitPlatformSections } from '@wildshard/sharddev/platformSections';
export const output = { platform: emitPlatformSections(new Map([['actors/moves', [
  { id: 'new-world.approach', kind: 'stalk', speed: 1, turn: 4, ground: true,
    above: 0, standOff: 0, ready: { kind: 'range' } }
]]])) };
`);
    await buildProject(project, output, { client: null, copyRuntime: true });
    const product = validateOutputFolder(output);
    expect(product.index.formatVersion).toBe(2);
    expect(product.index.identity.slug).toBe('new-world');
    expect(product.index.runtime).toBeNull();
    expect(product.index.sections.length).toBeGreaterThan(0);
    const moves = product.index.sections.find(section => section.name === 'actors/moves');
    if (moves === undefined) throw new Error('Missing authored move section');
    expect(JSON.parse(readFileSync(resolve(output, moves.path), 'utf8'))).toMatchObject([
      { id: 'new-world.approach', kind: 'stalk', speed: 1, turn: 4, ground: true,
        above: 0, standOff: 0, ready: { kind: 'range' } },
    ]);
    expect(existsSync(resolve(output, 'runtime'))).toBe(false);
    expect(readFileSync(resolve(project, 'README.md'), 'utf8')).toContain('no runtime TypeScript');
    expect(readFileSync(resolve(project, 'README.md'), 'utf8')).toContain('test/scripts/_template-boss.test.ts');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
