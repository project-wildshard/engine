#!/usr/bin/env node
// Same ordinary rules and custom plugin as the staged fast-lint worker.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, matchesGlob, resolve } from 'node:path';
import { readLintConfig } from './guard-counts.mjs';
import * as v from 'valibot';
import { fastLint } from './precommit-checks.mjs';
import { parallelFastLint } from './parallel-fast-lint.mjs';

const files = process.argv.slice(2);
if (files.some(file => file.startsWith('-'))) {
  console.error('lint:fast: expected file paths, not linter options');
  process.exitCode = 2;
} else {
  try {
    const executable=resolve('node_modules/.bin/oxlint'),manifest=resolve('.push-tracked.json');
    if (files.length===0 && existsSync(manifest)) {
      // An ignored tmp/ snapshot has no directory-walk selection. Use its exact
      // Git manifest; explicit paths still obey the configured generated ignores.
      const ignored=v.parse(v.object({ignorePatterns:v.optional(v.array(v.string()),[])}),readLintConfig('.oxlintrc.json')).ignorePatterns;
      const paths=v.parse(v.array(v.pipe(v.string(),v.check(file=>!isAbsolute(file)
        && file.split('/').every(part=>part!=='' && part!=='.' && part!=='..')))),JSON.parse(readFileSync(manifest,'utf8')))
        .filter(file=>/\.[cm]?[jt]sx?$/u.test(file) && !ignored.some(pattern=>matchesGlob(file,pattern)));
      if(paths.length===0)throw new Error('lint:fast: committed snapshot contains no lint sources');
      await parallelFastLint(paths,executable);
    } else if (files.length === 0) await parallelFastLint(null,executable);
    else fastLint(files,executable);
  }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
