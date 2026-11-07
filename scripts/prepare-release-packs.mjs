#!/usr/bin/env node
// Overlap the independent smoke and Vercel packages of the exact tested dist.
// Pull requests pack smoke artifacts without needing deployment credentials.
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runChecks } from './ci-checks.mjs';

const { values } = parseArgs({ options: {
  sha: { type: 'string' }, run: { type: 'string' }, vercel: { type: 'boolean', default: false },
  'install-cli': { type: 'boolean', default: false }, 'cli-ready': { type: 'string' },
} });
const sha = values.sha, run = values.run;
if (sha === undefined || !/^[a-f0-9]{40}$/u.test(sha) || run === undefined || !/^[0-9]+$/u.test(run)) {
  throw new Error('Release packaging requires the exact source SHA and run');
}
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sha
  || (process.env.GITHUB_SHA !== undefined && process.env.GITHUB_SHA !== sha)
  || (process.env.GITHUB_RUN_ID !== undefined && process.env.GITHUB_RUN_ID !== run)) {
  throw new Error('Release packaging differs from the checkout or CI run');
}
if (values['install-cli'] && (values.vercel || values['cli-ready'] === undefined)) {
  throw new Error('Early CLI installation requires its owned receipt and no packaging');
}
if (values.vercel && ['VERCEL_BUILD_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID'].some(key => !process.env[key])) {
  throw new Error('Requested Vercel packaging requires deployment credentials');
}

/** Quote paths, not credentials. Secret values remain environment references.
 * @param {string} value */
const quote = value => `'${value.replaceAll("'", String.raw`'\''`)}'`;
const node = quote(process.execPath);
const boot = `${node} scripts/boot-dist-plan.mjs > boot-dist-plan.json`
  + ` && python3 scripts/boot-dist.py pack --sha ${quote(sha)} --run ${quote(run)}`;
const project = "import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('.vercel',{recursive:true});"
  + "writeFileSync('.vercel/project.json',JSON.stringify({projectId:process.env.VERCEL_PROJECT_ID,orgId:process.env.VERCEL_ORG_ID}));";
const cliInstall = 'npm install --global vercel@59.11.2';
const cliReceipt = `${sha}\n${run}\nvercel@59.11.2\n`;
const cliReady = values['cli-ready'];
/** A tokenless, same-source/run installation only; never a persistent cache. */
function installedCli() {
  const result = spawnSync('vercel', ['--version'], {encoding:'utf8', maxBuffer:64 * 1024, timeout:5000});
  return result.status === 0 && result.stdout.trim() === '59.11.2';
}
function admittedCli() {
  if (cliReady === undefined) return false;
  try {
    // The owned runner-temp file is bounded and never transported/restored.
    const info = lstatSync(cliReady);
    if (!info.isFile() || info.size > 256) return false;
    if (readFileSync(cliReady, 'utf8') !== cliReceipt) return false;
    return installedCli();
  } catch { return false; }
}
const setup = `${values.vercel && admittedCli() ? 'true' : cliInstall} && ${node} --input-type=module -e ${quote(project)}`
  + ' && vercel pull --yes --environment production --scope raynos-projects --token "$VERCEL_BUILD_TOKEN"';

/** Reuse CI's owned process groups and failure drain. Never log secret argv.
 * @param {string[]} commands @param {string[]} labels */
async function phase(commands, labels) {
  const results = await runChecks(commands);
  for (const [i, result] of results.entries()) {
    console.log(`::group::${labels[i]} (${result.sec.toFixed(3)} s)`);
    process.stdout.write(result.out);
    console.log('::endgroup::');
  }
  if (results.some(result => result.code !== 0)) throw new Error('Release packaging failed; owned sibling commands drained');
}

const started = performance.now();
try {
  if (values['install-cli']) {
    await phase([cliInstall], ['Pinned release CLI installation']);
    if (!installedCli()) throw new Error('Installed release CLI differs from pinned 59.11.2');
    if (cliReady === undefined) throw new Error('Missing owned CLI receipt');
    writeFileSync(cliReady, cliReceipt);
  } else {
    // Both consumers read the final immutable dist. Vercel's package depends
    // on its setup, not on the independent smoke archive finishing. A failure
    // still drains the sibling and prevents the producer from succeeding.
    const vercel = `${setup} && ${node} scripts/build-vercel-output.mjs`
      + ` && python3 scripts/prebuilt-output.py pack --sha ${quote(sha)} --run ${quote(run)}`;
    await phase(values.vercel ? [boot, vercel] : [boot], values.vercel ? ['boot pack', 'Vercel setup and pack'] : ['boot pack']);
  }
  console.log(`${values['install-cli'] ? 'release CLI prerequisite' : 'release packaging'}: ${((performance.now() - started) / 1000).toFixed(3)} s`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Release packaging failed');
  process.exitCode = 1;
}
