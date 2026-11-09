// J193: one auditable selection for blocking and non-blocking CI cohorts.
import {appendFileSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, resolve as resolvePath} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** @param {unknown} value @param {string} original @param {number} admitted */
function extensionOf(value,original,admitted){
 if(value===undefined)return undefined;
 if(!record(value)||typeof value.reason!=='string'||value.reason.length<8||value.reason.length>1024
  ||typeof value.decidedBy!=='string'||!/^[\w.-]{1,64}$/u.test(value.decidedBy)||typeof value.grantedAt!=='string'||typeof value.deadline!=='string')throw new Error('J200 requires one recorded extension reason, decision owner and granted time');
 const granted=Date.parse(value.grantedAt),deadline=Date.parse(value.deadline),first=Date.parse(original);
 if(!Number.isFinite(granted)||granted<admitted||granted>Date.now()||!Number.isFinite(deadline)||deadline<=first||deadline-first>48*3_600_000)throw new Error('J200 permits one extension at most 48 hours past the original deadline');
 return {reason:value.reason,decidedBy:value.decidedBy,grantedAt:value.grantedAt,deadline:value.deadline};
}

/** The original deadline stays immutable; one separately recorded decision may extend it.
 * @param {{deadline:string,extension?:{deadline:string}}} entry */
export const quarantineDeadline=entry=>entry.extension?.deadline??entry.deadline;
/** Canonical field order, independent of JSON property spelling order.
 * @param {unknown} value */
const extensionKey=value=>record(value)?JSON.stringify([value.reason,value.grantedAt,value.deadline,value.decidedBy]):'';

/** Read committed policy, refusing malformed or ambiguous entries.
 * @param {string|URL} [policyFile] */
export function readQuarantine(policyFile=new URL('../test/quarantine.json', import.meta.url)) {
  const raw = /** @type {unknown} */ (JSON.parse(readFileSync(policyFile, 'utf8')));
  if (!record(raw) || raw.schema !== 1 || !Array.isArray(raw.entries)) throw new Error('Invalid J193 quarantine policy');
  /** @type {Set<string>} */ const seen = new Set();
  return raw.entries.map((/** @type {unknown} */ value) => {
    if (!record(value) || typeof value.file !== 'string' || typeof value.owner !== 'string'
      || typeof value.addedAt !== 'string' || typeof value.deadline !== 'string' || typeof value.reason !== 'string') throw new Error('Incomplete quarantine entry');
    const {file, owner, addedAt, deadline, reason} = value;
    if (!/^test\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.test\.(?:ts|mjs)$/u.test(file)
      || !/^[a-z][a-z0-9_-]+$/u.test(owner) || !Number.isFinite(Date.parse(deadline)) || reason.length < 8 || seen.has(file)) throw new Error('Invalid quarantine identity, deadline or reason');
    const admitted=Date.parse(addedAt),ends=Date.parse(deadline);
    if(!Number.isFinite(admitted)||admitted>Date.now()||ends<=admitted||ends-admitted>48*3_600_000)throw new Error(`Quarantine must end within 48 hours of its admission: ${file}`);
    seen.add(file);
    const extension=extensionOf(value.extension,deadline,admitted);
    return {file, owner, addedAt, deadline, reason,extension};
  });
}

/** Expiry restores blocking coverage automatically; it never drops a test. */
export function activeQuarantineFiles(now = Date.now()) {
  return readQuarantine().filter(entry => Date.parse(entry.addedAt)<=now&&Date.parse(quarantineDeadline(entry)) > now).map(entry => entry.file);
}

/** A rewritten date cannot restart an existing admission's 48-hour clock.
 * @param {string} [root] */
export function assertQuarantineHistory(root=process.cwd()){
 const entries=readQuarantine(resolvePath(root,'test/quarantine.json'));
 /** @param {string[]} args */
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).trim();
 if(git(['rev-parse','--is-shallow-repository'])!=='false')throw new Error('Quarantine admission history requires fetch-depth: 0');
 const history=git(['log','--reverse','--first-parent','--format=%H %ct','--','test/quarantine.json']);
 /** @type {Map<string,{at:number,deadline:string,order:number}>} */const admissions=new Map();
 /** @type {Map<string,{value:string,at:number,order:number}>} */const extensions=new Map();
 let order=0;
 for(const line of history.split('\n').filter(Boolean)){
  const [sha,seconds]=line.split(' ');
  /** @type {unknown} */const value=JSON.parse(git(['show',`${sha}:test/quarantine.json`]));
  if(!record(value)||!Array.isArray(value.entries))throw new Error('Invalid historical quarantine admission');
  for(const historical of value.entries.filter(record)){
   if(typeof historical.file!=='string'||typeof historical.deadline!=='string')throw new Error('Incomplete historical quarantine admission');
   // Never overwrite a first admission, even after removal and re-admission.
   if(!admissions.has(historical.file))admissions.set(historical.file,{at:Number(seconds)*1000,deadline:historical.deadline,order});
   if(historical.extension!==undefined&&!extensions.has(historical.file))extensions.set(historical.file,{value:extensionKey(historical.extension),at:Number(seconds)*1000,order});
  }
  order++;
 }
 for(const entry of entries){
  const aliases=new Set([entry.file]);
  for(const row of git(['log','--follow','--find-renames=1%','--format=','--name-status','--',entry.file]).split('\n')){
   const rename=/^R\d+\t([^\t]+)\t([^\t]+)$/u.exec(row);if(rename?.[1]!==undefined&&rename[2]!==undefined){aliases.add(rename[1]);aliases.add(rename[2]);}
  }
  const first=[...aliases].flatMap(alias=>{const found=admissions.get(alias);return found===undefined?[]:[found];}).sort((a,b)=>a.order-b.order)[0];
  if(first===undefined||first.at!==Date.parse(entry.addedAt)||first.deadline!==entry.deadline)throw new Error(`Quarantine admission and original deadline must match the first introducing commit, including renames: ${entry.file}`);
  const decision=[...aliases].flatMap(alias=>{const found=extensions.get(alias);return found===undefined?[]:[found];}).sort((a,b)=>a.order-b.order)[0];
  if(entry.extension!==undefined&&(decision===undefined||decision.value!==extensionKey(entry.extension)||Date.parse(entry.extension.grantedAt)>decision.at)
    ||entry.extension===undefined&&decision!==undefined)throw new Error(`J200 extension decision is once-only and immutable: ${entry.file}`);
 }
 return entries;
}

async function main() {
  const args = process.argv.slice(2), shardArgs = args.filter(arg => arg.startsWith('--shard='));
  if (shardArgs.length > 1 || args.some(arg => arg !== '--list' && arg !== '--check-history' && !arg.startsWith('--shard='))) throw new Error('Expected --list, --check-history or at most one --shard=i/n');
  if(args.includes('--check-history')){console.log(`J193 first-admission history valid for ${assertQuarantineHistory().length} entries; at most 48 hours plus one recorded J200 extension`);return 0;}
  const shard = shardArgs[0]?.slice(8) ?? '1/1';
  if (!/^[1-9]\d*\/[1-9]\d*$/u.test(shard)) throw new Error('Invalid quarantine shard');
  const parts = shard.split('/'), index = Number(parts[0]), count = Number(parts[1]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count) throw new Error('Invalid quarantine shard bounds');
  const entries = readQuarantine(), active = activeQuarantineFiles();
  // Partition committed entry positions, so expiry never moves another file
  // between shards. Every active entry has exactly one owner group.
  const files = entries.filter((entry, position) => position % count === index - 1 && active.includes(entry.file)).map(entry => entry.file);
  const rows = entries.map(entry => ({file: entry.file, owner: entry.owner, deadline: quarantineDeadline(entry), originalDeadline:entry.deadline, extension:entry.extension, reason: entry.reason, active: active.includes(entry.file), selected: files.includes(entry.file)}));
  console.log('J193 quarantine policy', JSON.stringify(rows));
  if (process.argv.includes('--list')) return 0;
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary,
    `### J193 quarantine ${shard} (non-blocking, executed separately)\n\n${rows.map(row => {
      let status = 'expired — blocking again';
      if (row.active) status = row.selected ? 'executed here' : 'another shard';
      return `- ${row.file}: owner ${row.owner}, deadline ${row.deadline}; ${status}`;
    }).join('\n')}\n`);
  if (files.length === 0) { console.log('No active files in this quarantine shard.'); return 0; }
  const report = resolvePath(process.env.WS_QUARANTINE_REPORT ?? `tmp/quarantine/results-${index}-of-${count}.json`);
  mkdirSync(dirname(report), {recursive: true});
  // This job installs full products even in ring-1: some of these files need
  // Driftwood and the whole road, beyond Ring 1's three-product inventory.
  /** @type {NodeJS.ProcessEnv} */ const env = {...process.env, WS_TEST_QUARANTINE: 'only', WS_CI_TIMINGS: `${report}.timings.json`};
  delete env.WILDSHARD_RING;
  const child = spawn(process.execPath, [fileURLToPath(new URL('vitest-tmp.ts', import.meta.url)), 'run', ...files,
    '--maxWorkers=1', '--reporter=default', '--reporter=json', '--reporter=./scripts/engine-ci-budget.ts', `--outputFile=${report}`], {env, stdio: 'inherit'});
  /** @type {Promise<number>} */ const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(signal === null ? code ?? 1 : 1)); });
  const code = await completed;
  const verdict = `J193 executed ${files.length} quarantined files; exit ${code}; original results ${report}`;
  console.log(verdict);
  if (summary) appendFileSync(summary, `\n${verdict}\n`);
  if(code!==0&&process.env.GITHUB_ACTIONS)for(const entry of entries.filter(candidate=>files.includes(candidate.file)))
    console.error(`::error title=Quarantine owner ${entry.owner}::${entry.file} failed its reported cohort; deadline ${quarantineDeadline(entry)}`);
  // Preserve the real exit status. Only the workflow's explicit
  // continue-on-error makes this cohort non-blocking.
  return code;
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
