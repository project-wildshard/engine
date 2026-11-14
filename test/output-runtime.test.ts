// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures own their temporary source and output directories.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All fixture paths stay under the owned tmp directory.
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { defineMirror } from '@wildshard/sharddev/runtimeMirrors';
import { runtimeCodeLines, validateRuntimeData, writeRuntimeFiles } from '@wildshard/sharddev/outputRuntime';
import { codeLines } from '../scripts/host-ruler.mjs';

const owned: string[] = [];
afterEach(() => { for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture(): { project: string; output: string } {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(join(resolve('tmp'), 'runtime-copy-')); owned.push(root);
  const project = join(root, 'source'), output = join(root, 'out'); mkdirSync(project);
  return { project, output };
}
function put(project: string, path: string, source: string): void { const file = join(project, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source); }
it('ships no runtime TypeScript: declarations pass, a stale runtime output is cleared and other outputs stay', () => {
  const { project, output } = fixture();
  put(project, 'runtime/types.d.ts', 'declare const globalValue: number;\n'); put(project, 'runtime/nested/more.d.ts', 'export {};\n');
  put(project, 'data/not-runtime.ts', 'throw new Error("not copied");');
  put(output, 'runtime/stale.ts', 'old'); put(output, 'sections/keep.json', '{}');
  expect(writeRuntimeFiles(project, output)).toEqual({ files: [], lines: 0 });
  expect(existsSync(join(output, 'runtime'))).toBe(false); expect(existsSync(join(output, 'data'))).toBe(false);
  expect(readFileSync(join(output, 'sections/keep.json'), 'utf8')).toBe('{}');
  expect(writeRuntimeFiles(project, output)).toEqual({ files: [], lines: 0 });
});
it('uses the ruler comment law for templates, regexes, strings and multiline comments', () => {
  const sources = ['// alone\n/* block\n * alone */\nexport const x = 1; // tail\n',
    `export const x = \`/* not a comment */\n// still text\n\${1 /* real */ + 2}\`;\n`,
    'const pattern = /[/*]+/u;\nexport const x = "// text";\n', '\uFEFF// BOM\r\nexport const x = 1;\r\n'];
  for (const source of sources) expect(runtimeCodeLines(source)).toBe(codeLines(source));
  expect(() => runtimeCodeLines('export const = ;')).toThrow('Invalid runtime');
});
it('refuses executable source, non-TS and symlinks before changing a previous output (LD9: no copied runtime entry)', () => {
  const { project, output } = fixture(); put(output, 'runtime/retained.ts', 'previous');
  put(project, 'runtime/index.ts', 'export default 1;');
  expect(() => writeRuntimeFiles(project, output)).toThrow('cannot contain executable source: runtime/index.ts');
  expect(readFileSync(join(output, 'runtime/retained.ts'), 'utf8')).toBe('previous');
  rmSync(join(project, 'runtime/index.ts')); put(project, 'runtime/helper.ts', 'export const x = 1;');
  expect(() => writeRuntimeFiles(project, output)).toThrow('cannot contain executable source: runtime/helper.ts');
  rmSync(join(project, 'runtime/helper.ts')); put(project, 'runtime/a.json', '{}');
  expect(() => writeRuntimeFiles(project, output)).toThrow('TypeScript files only');
  rmSync(join(project, 'runtime/a.json')); symlinkSync(join(output, 'runtime/retained.ts'), join(project, 'runtime/link.d.ts'));
  expect(() => writeRuntimeFiles(project, output)).toThrow('symlinks');
  expect(readFileSync(join(output, 'runtime/retained.ts'), 'utf8')).toBe('previous');
});
it('supports data-only projects and refuses overlapping output', () => {
  const { project, output } = fixture(); expect(writeRuntimeFiles(project, output)).toEqual({ files: [], lines: 0 });
  expect(() => writeRuntimeFiles(project, join(project, 'out'))).toThrow('separate');
});

it('checks copied constants against unchanged mirrors without a custom registry', () => {
  const mirrors=[defineMirror('COUNT',2)];
  expect(()=>validateRuntimeData(mirrors,{COUNT:2})).not.toThrow();
  expect(()=>validateRuntimeData(mirrors,{COUNT:3})).toThrow('COUNT');
  expect(()=>validateRuntimeData(mirrors,undefined)).toThrow('runtime/const.ts');
  expect(()=>validateRuntimeData([],undefined)).not.toThrow();
});

it('admits the compiled Driftwood source without copying retired runtime data', () => {
  const { output } = fixture();
  expect(writeRuntimeFiles(resolve('src/shards/driftwood-isle'), output)).toEqual({ files: [], lines: 0 });
});

it.each(['runtime/sections.ts','runtime/folderSections.d.ts'])('refuses retired custom registry %s before deleting any output', path => {
  const {project,output}=fixture();
  put(project,path,'export {};');put(output,'runtime/keep.d.ts','keep');
  expect(()=>writeRuntimeFiles(project,output)).toThrow('Custom runtime registries are retired');
  expect(readFileSync(join(output,'runtime/keep.d.ts'),'utf8')).toBe('keep');
});
