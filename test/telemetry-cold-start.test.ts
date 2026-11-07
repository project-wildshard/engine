// oxlint-disable-next-line import/no-nodejs-modules -- This Node fixture emits and cleans a compiled function artifact.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the native function artifact within the repository scratch root.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Cold-start the actual compiled API in a separate Node process.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Use this Node binary and explicit fixture-only credential values.
import { env, execPath } from 'node:process';
import * as ts from '@typescript/typescript6';
import { expect, it } from 'vitest';

it('starts the compiled telemetry handler without source workspace exports', () => {
  const root = resolve(import.meta.dirname, '..');
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const output = mkdtempSync(join(root, 'tmp/telemetry-function-'));
  try {
    // Vercel emits .js beside the API's relative dependencies. Workspace
    // package exports still name .ts source, which is absent in its function.
    const program = ts.createProgram([join(root, 'api/telemetry.ts')], {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true,
      rootDir: root, outDir: output, types: ['node'], skipLibCheck: true,
      verbatimModuleSyntax: true,
    });
    expect(program.emit().emitSkipped).toBe(false);
    writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'module' }));
    const workspace = join(output, 'node_modules/@wildshard/format');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({
      name: '@wildshard/format', type: 'module', exports: { './contentBounds': './contentBounds.ts' },
    }));
    const result = spawnSync(execPath, ['--input-type=module', '-e', `
      import { GET, OPTIONS, POST } from './api/telemetry.js';
      const url = 'https://fixture.invalid/api/telemetry';
      const options = OPTIONS(new Request(url, { method: 'OPTIONS' }));
      const get = await GET(new Request(url));
      const post = await POST(new Request(url, { method: 'POST', body: '{}' }));
      console.log(JSON.stringify([options.status, get.status, post.status]));
    `], { cwd: output, encoding: 'utf8', env: { ...env, REVIEW_PASSWORD: '', BLOB_READ_WRITE_TOKEN: '' } });
    expect(result.status, result.stderr).toBe(0);
    const statuses: unknown = JSON.parse(result.stdout);
    expect(statuses).toEqual([204, 503, 400]);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
