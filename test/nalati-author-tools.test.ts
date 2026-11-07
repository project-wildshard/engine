// oxlint-disable-next-line import/no-nodejs-modules -- Compare standalone author command programs without opening a browser or publishing assets.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Validate each moved command's actual repository-root expression.
import { cwd } from 'node:process';
import { expect, test } from 'vitest';
import { authorToolProgram } from './fixtures/author-tool-source';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import original from './fixtures/nalati-author-tools-original.json' with { type: 'json' };

for (const row of original) test(`${row.script} retains the complete original author command`, () => {
  const source = readFileSync(row.script, 'utf8');
  const program = new TextEncoder().encode(authorToolProgram(cwd(), row.script, source));
  expect(hashImmutableBytes(program)).toBe(row.programSha256);
  expect(hashImmutableBytes(new TextEncoder().encode(source))).not.toBe(row.beforeSha256);
  const brokenRoot = source.replace(/resolve\(import\.meta\.dirname, '[./]+'\)/u, "resolve(import.meta.dirname, '../outside')");
  expect(() => authorToolProgram(cwd(), row.script, brokenRoot)).toThrow('repository');
});
