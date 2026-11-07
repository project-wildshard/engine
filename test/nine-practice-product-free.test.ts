// oxlint-disable-next-line import/no-nodejs-modules -- Prove collection in a fresh process with no product directory.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own the small isolated fixture inputs and emitted test module.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the isolation fixture inside repository scratch.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the same Node runtime as the actual behaviour worker.
import process from 'node:process';
import { expect, test } from 'vitest';
import { build } from 'vite';

test('the actual shared practice fixture collects with only its static inputs and no out products', async () => {
  const scratch = mkdtempSync(resolve('tmp/nine-practice-free-'));
  try {
    for (const path of ['test/fixtures', 'src/commons/scripts']) mkdirSync(resolve(scratch, path), { recursive: true });
    for (const path of ['test/fixtures/nine-practice-course.wasm', 'src/commons/scripts/course.as']) {
      writeFileSync(resolve(scratch, path), readFileSync(path));
    }
    const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
      lib: { entry: resolve('test/fixtures/nine-practice-product.ts'), formats: ['es'] },
      rolldownOptions: { external: [/^node:/u], output: { codeSplitting: false } } } });
    const built = Array.isArray(result) ? result[0] : result;
    if (built === undefined || !('output' in built)) throw new Error('Missing practice fixture bundle');
    const chunks = built.output.filter(row => row.type === 'chunk'); expect(chunks).toHaveLength(1);
    const chunk = chunks[0]; if (chunk === undefined) throw new Error('Missing fixture chunk');
    expect(Object.keys(chunk.modules).some(path => path.includes('assemblyscript') || path.endsWith('/project.ts'))).toBe(false);
    writeFileSync(resolve(scratch, 'fixture.mjs'), chunk.code);
    writeFileSync(resolve(scratch, 'entry.mjs'), "import { ninePracticeBytes, ninePracticeRows } from './fixture.mjs';\nconsole.log(JSON.stringify({ bytes: ninePracticeBytes.byteLength, module: ninePracticeRows.script.module, pages: ninePracticeRows.script.pages }));\n");
    expect(existsSync(resolve(scratch, 'out'))).toBe(false);
    const resultText = execFileSync(process.execPath, ['entry.mjs'], { cwd: scratch, encoding: 'utf8', timeout: 10_000 });
    expect(JSON.parse(resultText)).toEqual({ bytes: 9786,
      module: 'blobs/wasm/6ffc72748c1709f4239ac983fdda5841a524a026512287fe16f0fa498b276102.wasm', pages: 1 });
    expect(existsSync(resolve(scratch, 'out'))).toBe(false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
