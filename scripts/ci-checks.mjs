#!/usr/bin/env node
// SF74 W16: push CI's node checks in parallel. Runs `pnpm gen` once, then every other command of package.json's
// `test:checks` (read here, so the list never drifts) and each extra chain given on the command line, all at once, and
// prints each one's wall time. The serial chain took ~205 s on the CI runner (2026-10-09: bake-check ~110 s, ratchet ~69 s).
//   node scripts/ci-checks.mjs ['<shell chain>' …]
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Run sibling checks as owned process groups. A first red stops the others;
 * signals from the enclosing CI command also drain these groups.
 * @param {string[]} commands
 * @returns {Promise<{command:string, code:number, sec:number, out:string}[]>} */
export async function runChecks(commands) {
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set();
  let refused = false;
  function stop() {
    for (const child of children) if (child.pid !== undefined) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
      const pid=child.pid;
      setTimeout(() => { if (children.has(child)) { try { process.kill(-pid,'SIGKILL'); } catch { /* already exited */ } } },1000).unref();
    }
  }
  const interrupted = () => { refused=true; stop(); };
  process.once('SIGTERM', interrupted); process.once('SIGINT', interrupted);
  try {
    return await Promise.all(commands.map(command => new Promise(resolve => {
      const started=Date.now();
      const child=spawn('bash',['-c',command],{stdio:['ignore','pipe','pipe'],detached:true});
      children.add(child);
      /** @type {Buffer[]} */
      const output=[];
      child.stdout.on('data',chunk => { output.push(chunk); });
      child.stderr.on('data',chunk => { output.push(chunk); });
      child.on('error',error => { output.push(Buffer.from(String(error))); });
      child.on('close',code => {
        children.delete(child);
        if (code!==0 && !refused) {
          refused=true;
          console.error(`::error::ci-checks: ${command} failed; stopping owned sibling checks`);
          stop();
        }
        resolve({command,code:code??1,sec:(Date.now()-started)/1000,out:Buffer.concat(output).toString('utf8')});
      });
    })));
  } finally {
    process.removeListener('SIGTERM',interrupted); process.removeListener('SIGINT',interrupted);
  }
}

async function main() {
/** @type {{ scripts: Partial<Record<string, string>> }} */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const chain = pkg.scripts['test:checks'];
if (chain === undefined) throw new Error('package.json has no test:checks');
const [first, ...checks] = chain.split(' && ').map((command) => command.trim());
if (first !== 'pnpm gen') throw new Error(`test:checks must start with pnpm gen, not ${first}`);
const prepared = process.argv.includes('--prepared');
const commands = [...checks, ...process.argv.slice(2).filter(arg => arg !== '--prepared')];

const t0 = Date.now();
if (prepared) {
  // This restores only a matching full SHA/run/checksum/inventory, refusing
  // missing or foreign artifacts before any checks/build can use their bytes.
  if (spawnSync('python3', ['scripts/ci-products.py','unpack'], { stdio:'inherit' }).status !== 0) process.exit(1);
  const sha = process.env.GITHUB_SHA;
  if (sha === undefined || !/^[a-f0-9]{40}$/u.test(sha)) throw new Error('Verified preparation requires the exact CI SHA');
  // The unpacker has verified checkout SHA, run, checksum and full inventory.
  // Its children consume that restored product, just like the product cohort;
  // machine-local input/cache receipts are deliberately absent from artifacts.
  process.env.WS_TEST_PRODUCTS_SHA = sha;
  process.env.VERCEL_GIT_COMMIT_SHA = sha;
  console.log(`ci-checks: verified same-run preparation ${((Date.now()-t0)/1000).toFixed(0)} s; running ${commands.length} in parallel`);
} else {
  if (spawnSync('pnpm', ['gen'], { stdio: 'inherit' }).status !== 0) process.exit(1);
  console.log(`ci-checks: gen ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`ci-checks: shard programs complete; running ${commands.length} in parallel`);
}

const results = await runChecks(commands);
// Each command's output in one group, so parallel logs never interleave.
for (const r of results) {
  console.log(`::group::${r.code === 0 ? '✓' : '✗'} ${r.command} (${r.sec.toFixed(0)} s)`);
  process.stdout.write(r.out);
  console.log('::endgroup::');
}
for (const r of [...results].sort((a, b) => b.sec - a.sec)) console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.sec.toFixed(0).padStart(4)} s  ${r.command}`);
const failed = results.filter((r) => r.code !== 0);
for (const r of failed) console.log(`::error::ci-checks: ${r.command} exited ${r.code}`);
console.log(`ci-checks: ${((Date.now() - t0) / 1000).toFixed(0)} s wall, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);

}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
