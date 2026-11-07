// oxlint-disable-next-line import/no-nodejs-modules -- Small source-defined compiler fixture under the owned tmp directory.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the owned compiler fixture only.
import { resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { expect, test } from 'vitest';
import { maximumResidentBytes, readingCommands } from '../scripts/generated-input-reading.mjs';

test('Mac default-four/eight comparison retains full cold checks and one unpartitioned typed lint', () => {
  const rows = readingCommands();
  expect(rows.map(row => row.name)).toEqual(['root-checkers-4', 'root-checkers-8', 'full-typed-lint']);
  for (const [index, checkers] of [4, 8].entries()) {
    expect(rows[index]?.args).toEqual(['--noEmit', '--incremental', 'false', '--checkers', String(checkers), '-p', 'tsconfig.json']);
  }
  expect(rows[2]?.args).toEqual(['scripts/lint-all.mjs']);
  expect(maximumResidentBytes('  456789 maximum resident set size\n')).toBe(456789);
  expect(maximumResidentBytes('time: command refused\n')).toBeNull();
  expect(maximumResidentBytes('0 maximum resident set size\n')).toBeNull();
});

test('generated-root narrowing preserves authored inference and checks retained static dependencies', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/gr12-json-types-'));
  try {
    mkdirSync(resolve(root, 'src/data'), { recursive: true });
    for (const [name, value] of [['authored.json', { count: 3 }], ['unused.generated.json', { huge: [1, 2] }],
      ['live.generated.json', { count: 9 }]] as const) writeFileSync(resolve(root, 'src/data', name), JSON.stringify(value));
    writeFileSync(resolve(root, 'src/consumer.ts'), "import authored from './data/authored.json';\nimport live from './data/live.generated.json';\nconst wrong: string = authored.count;\nconst other: string = live.count;\nexport { wrong, other };\n");
    const input: unknown = { compilerOptions: { noEmit: true, strict: true, resolveJsonModule: true,
      esModuleInterop: true, module: 'ESNext', moduleResolution: 'bundler', types: [], skipLibCheck: true },
    files: ['src/data/live.generated.json'], include: ['src', 'src/**/*.json'], exclude: ['src/**/*.generated.json'] };
    const config = ts.parseJsonConfigFileContent(input, ts.sys, root);
    expect(config.errors).toEqual([]);
    const program = ts.createProgram(config.fileNames, config.options), diagnostics = ts.getPreEmitDiagnostics(program);
    expect(diagnostics.filter(diagnostic => diagnostic.code === 2322)).toHaveLength(2);
    expect(program.getSourceFiles().some(file => file.fileName.endsWith('/unused.generated.json'))).toBe(false);
    expect(program.getSourceFiles().some(file => file.fileName.endsWith('/authored.json'))).toBe(true);
    expect(program.getSourceFiles().some(file => file.fileName.endsWith('/live.generated.json'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
