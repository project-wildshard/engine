// The code-quality lanes, keyed off package.json scripts so they switch
// on by themselves once the scaffold defines them.
//   commit: like the scaffold's own pre-commit: `lint` and `format:check`
//           on the staged code files only, plus the whole `typecheck`,
//           in parallel under a budget (silent < 5 s, warn 5-8 s, BLOCK
//           > 8 s; SKIP_BUDGET=1). Skipped when no code or JSON is staged.
//   push:   the full `check` script (adds knip and the unit tests).
// The hooks only check; `pnpm lint:fix` / `pnpm format` fix.
// Bypass a lane: SKIP_CHECK=1 (last resort; CI still runs it).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './lib.mjs';

const lane = process.argv[2];
const root = git(['rev-parse', '--show-toplevel']).trim();
const SOFT = Number(process.env.PRECOMMIT_SOFT_S ?? 5);
const HARD = Number(process.env.PRECOMMIT_HARD_S ?? 8);
const LINTABLE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const FORMATTABLE = /\.(?:ts|tsx|js|mjs|cjs|json|jsonc)$/;

if (process.env.SKIP_CHECK === '1') {
  console.error(`  - SKIP_CHECK=1: ${lane} lane skipped (CI still runs it)`);
  process.exit(0);
}
// The package is at the repo root; its configs live in src/.
const pkgDir = root;
const pkgPath = join(pkgDir, 'package.json');
const scripts = existsSync(pkgPath) ? (JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}) : {};

if (lane === 'push' && scripts.check && existsSync(join(root, 'scripts/push-budget.mjs'))) {
  const {pushEnvironment}=await import('./push-checks.mjs');
  const {PUSH_PROFILE}=await import('../scripts/push-budget.mjs');
  const {pushSelection}=await import('../scripts/push-selection.mjs');
  const {capturePushTree,readPushProof}=await import('../scripts/push-proof-cache.mjs');
  const {missingTestTimings}=await import('../scripts/push-test-timings.mjs');
  const env = pushEnvironment(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))));
  const context=capturePushTree(PUSH_PROFILE,env),proof=context===null||missingTestTimings(env.WS_PUSH_REFS).length>0?null:readPushProof(context,pushSelection(env.WS_PUSH_REFS));
  // Outgoing history/secrets have already passed in pre-push. Reusing a proved
  // tree starts no heavy work, so it must not wait behind a later full suite.
  if(proof!==null){
    console.error(`  - exact-tree green reuse before lease: ${proof.tree}; run ${proof.run}; commit ${proof.commit}; ${proof.mode}; ${proof.seconds.toFixed(1)} s; ${proof.finished}`);
    process.exit(0);
  }
  // A miss owns the lane before generation/static work too.
  const observation=process.argv[3]==='--release-observation'?['--observation-kind','release']:[];
  const child = spawn('python3', ['scripts/heavy-lane.py', 'full-test', '--checkout-scope', ...observation, '--', process.execPath, '.githooks/push-checks.mjs'],
    { cwd: pkgDir, env: { ...env, WS_PUSH_GATE_PROFILE: 'full-v1', WS_CPU_ADMISSION: '1' }, stdio: 'inherit' });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  const code = await new Promise(resolveCode => {
    child.once('error', error => { console.error(error); resolveCode(1); });
    child.once('close', value => resolveCode(value ?? 1));
  });
  process.exit(code);
}

/** @type {{ name: string, args: string[] }[]} */
const jobs = [];
if (lane === 'commit') {
  // Staged code under src/, passed relative to the repo root (the
  // package root). Code outside src/ (.githooks, docs) has its own checks.
  const staged = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).split('\0').filter(Boolean)
    .filter((path) => path.startsWith('src/'));
  const lint = staged.filter((path) => LINTABLE.test(path));
  const format = staged.filter((path) => FORMATTABLE.test(path));
  if (scripts.lint && lint.length) jobs.push({ name: 'lint', args: ['lint', ...lint] });
  if (scripts['format:check'] && format.length) {
    jobs.push({ name: 'format:check', args: ['format:check', '--no-error-on-unmatched-pattern', ...format] });
  }
  if (scripts.typecheck && format.length) jobs.push({ name: 'typecheck', args: ['typecheck'] });
  if (!jobs.length) {
    if (Object.keys(scripts).length) console.error('  - no code staged: commit lane skipped');
    process.exit(0);
  }
} else if (scripts.check) {
  jobs.push({ name: 'check', args: ['check'] });
}
if (!jobs.length) process.exit(0); // no toolchain yet

if (!existsSync(join(pkgDir, 'node_modules'))) {
  console.error(`\n  X ${lane} blocked: node_modules is missing. Run pnpm install (or SKIP_CHECK=1).\n`);
  process.exit(1);
}

// Hooks export GIT_INDEX_FILE and friends; tools that shell out to git
// (knip, tests that build repos) must see a normal environment.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const run = ({ name, args }) => new Promise((done) => {
  const child = spawn('pnpm', ['run', '--silent', ...args], { cwd: pkgDir, env });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  child.on('close', (code) => done({ name, code, output }));
});

console.error(`  - ${lane} lane: pnpm ${jobs.map((job) => job.name).join(', ')}`);
const started = Date.now();
const results = await Promise.all(jobs.map(run));
const seconds = (Date.now() - started) / 1000;

const failed = results.filter((result) => result.code !== 0);
for (const { name, output } of failed) console.error(`\n  X pnpm ${name} failed:\n${output.trim().replace(/^/gm, '    ')}`);
if (failed.length) {
  const fix = lane === 'commit' ? ' (pnpm lint:fix / pnpm format fix most of it)' : '';
  console.error(`\n  ${lane} blocked. Fix it${fix}; SKIP_CHECK=1 is a last resort.\n`);
  process.exit(1);
}

if (lane === 'commit') {
  if (seconds > HARD && process.env.SKIP_BUDGET !== '1') {
    console.error(`\n  X commit blocked: the commit lane took ${seconds.toFixed(1)} s, over the ${HARD} s budget.`);
    console.error('    Something slow crept in; move it to the push lane. Loaded machine? SKIP_BUDGET=1.\n');
    process.exit(1);
  }
  if (seconds > SOFT) console.error(`  !! commit lane took ${seconds.toFixed(1)} s (soft ${SOFT} s, hard ${HARD} s)`);
}
console.error(`  - ${lane} lane green in ${seconds.toFixed(1)} s`);
