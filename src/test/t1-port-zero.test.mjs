import { expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';

// The browser command is a native HTTP client here; the actual CLI and preview child run unchanged.
test('two T1 CLI starts own actual preview ports and stop both listeners', async () => {
  const base = resolve('tmp/codex-pagesize'); mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, 't1-cli-zero-')), ports = [];
  try {
    const dist = join(work, 'dist'), bin = join(work, 'bin'); mkdirSync(dist); mkdirSync(bin);
    writeFileSync(join(dist, 'version.json'), JSON.stringify({ build: 't1-zero-native' }));
    writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}\nimport fs from 'node:fs';\n(async()=>{const port=Number(process.env.WS_T1_PORT);const response=await fetch('http://127.0.0.1:'+port+'/version.json',{signal:AbortSignal.timeout(2000)});if((await response.json()).build!=='t1-zero-native')process.exit(2);fs.writeFileSync(process.env.T1_PORT_RECEIPT,String(port));})().catch(()=>process.exit(3));\n`, { mode: 0o700 });
    const results = await Promise.allSettled([0, 1].map(async index => {
      const receipt = join(work, `port-${index}`), scratchRoot = join(work, `scratch-${index}`);
      await promisify(execFile)(process.execPath, ['src/scripts/t1-e2e.mjs'], { timeout: 30_000, env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, WS_T1_BUILD_DIR: dist, WS_T1_SCRATCH_ROOT: scratchRoot, WS_LANE_NAME: 'codex-pagesize', T1_PORT_RECEIPT: receipt } });
      expect(existsSync(join(scratchRoot, 'tmp/codex-pagesize/.owner'))).toBe(true);
      ports.push(Number(readFileSync(receipt, 'utf8')));
    }));
    expect(results.filter(result => result.status === 'rejected').map(result => result.reason.message)).toEqual([]);
    expect(ports.every(port => Number.isInteger(port) && port > 0)).toBe(true);
    expect(new Set(ports).size).toBe(2);
    for (const port of ports) await expect(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 45_000);
