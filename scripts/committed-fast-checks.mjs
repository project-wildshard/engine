// G675: fast checks read exact Git blobs; typed checks and tests belong to CI.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';
import { basename, dirname, matchesGlob, relative, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { pathToFileURL } from 'node:url';
import { gitSourceView, installGitSourceView, deriveGitVocabulary, deriveGitStarterTables, deriveGitDiscovery } from './git-source-view.mjs';
import { gitRuleCount } from './git-rule-counts.mjs';
import * as v from 'valibot';

/** @param {string} root @param {string} base @param {string} tip @param {string} phase @param {string[]} paths */
export async function committedFastChecks(root,base,tip,phase,paths) {
  process.chdir(root);
  const view=gitSourceView(root,tip);
  const json=(/** @type {ReturnType<typeof gitSourceView>} */ source,/** @type {string} */ path,/** @type {object} */ fallback={})=>source.files.has(path)?JSON.parse(source.read(path).toString('utf8')):fallback;
  installGitSourceView(view);
  /** @param {string} path @returns {Promise<unknown>} */
  const module=path=>import(pathToFileURL(resolve(root,path)).href);
  const failures=[];
  mkdirSync(resolve(root,'tmp'),{recursive:true});
  const temporary=mkdtempSync(resolve(root,'tmp/push-config-'));
  try {
    if(phase==='storage') {
      const {createChecker}=/** @type {typeof import('./repo-size.mjs')} */(await module('scripts/repo-size.mjs'));
      const result=createChecker({cwd:root}).checkPush(`refs/heads/main ${tip} refs/heads/main ${base}\n`,{rangeOnly:true});
      console.log(`repo-size: ${result.commits} exact outgoing commits passed`);
    } else if(phase==='fast-lint'||phase==='ratchet'||phase==='ratchet-counts') {
      const {readLintConfig,hardRules}=/** @type {typeof import('./guard-counts.mjs')} */(await module('scripts/guard-counts.mjs'));
      const hard=hardRules(resolve(root,'.oxlintrc.json'));
      const {fastCommitLintConfig}=/** @type {typeof import('./precommit-checks.mjs')} */(await module('scripts/precommit-checks.mjs'));
      const policy=json(view,'lint/ratchet.json');
      const config=resolve(root,`.${basename(temporary)}.json`),allowance=resolve(temporary,'ratchet.json');
      process.env.WS_GIT_CHECK_CONFIG=config;process.env.WILDSHARD_RATCHET_FILE=allowance;
      writeFileSync(allowance,JSON.stringify(policy));
      const roots=paths.filter(path=>/\.[cm]?[jt]sx?$/u.test(path)&&view.files.has(path));
      if(phase==='fast-lint') {
        await deriveGitStarterTables(view);
        const {WS_GIT_NATIVE_REPORT_ONLY:reportOnly,WS_GIT_NATIVE_ROOT:nativeRoot}=process.env;
        const deferNative=reportOnly==='1'&&nativeRoot===root;
        const nativePending=new Set();
        const settings=fastCommitLintConfig(readLintConfig(resolve(root,'.oxlintrc.json')));
        settings.jsPlugins=(settings.jsPlugins??[]).map(/** @param {string|{specifier:string}} item */ item=>{
          if(typeof item==='string')return resolve(root,item);
          item.specifier=resolve(root,item.specifier);return item;
        });
        writeFileSync(config,JSON.stringify(settings));
        // Rust's source/import resolution needs matching native inputs. JS
        // plugins and their lint/ policy reads already use the immutable Git
        // view in both processes; loose policy bytes are never authoritative.
        const shared=[...view.files.keys()].filter(path=>/^\.oxlint|^(?:src\/[^/]+\/)?(?:package|tsconfig[^/]*)\.json$|^pnpm-lock\.yaml$/u.test(path));
        const mismatchedShared=shared.filter(path=>!view.matches(path));
        if(mismatchedShared.length>0) {
          for(const file of roots)console.log(`DEFERRED TO CI fast-lint ${file}: unverified configuration ${mismatchedShared.join(', ')}`);
          return;
        }
        const closure=(/** @type {string} */ selected)=>{
          const seen=new Set(shared),missing=new Set(),mismatched=new Set();
          const visit=(/** @type {string} */ file)=>{
            if(missing.size>0||mismatched.size>0||seen.has(file))return;seen.add(file);
            if(!view.matches(file)){mismatched.add(file);return;}
            if(!/\.[cm]?[jt]sx?$/u.test(file))return;
            for(const imported of ts.preProcessFile(view.read(file).toString('utf8'),true,true).importedFiles) {
              const source=imported.fileName.split(/[?#]/u)[0]??'';
              let target=source.startsWith('.')?relative(root,resolve(root,dirname(file),source)):null;
              const packageName=/^@wildshard\/([^/]+)(?:\/(.+))?$/u.exec(source);
              if(packageName!==null) {
                // Format installs from the shardfile repo (J81): the lockfile in `shared` pins it, as it does any dependency.
                if(!view.files.has(`src/${packageName[1]}/package.json`))continue;
                const entry=json(view,`src/${packageName[1]}/package.json`).exports?.[packageName[2]===undefined?'.':`./${packageName[2]}`];
                if(typeof entry!=='string'||!entry.startsWith('./')){missing.add(source);continue;}
                target=`src/${packageName[1]}/${entry.slice(2)}`;
              }
              if(target===null)continue;
              let resolved,deferred=false;
              for(const path of [target,`${target}.ts`,`${target}.tsx`,`${target}.mts`,`${target}.mjs`,`${target}.js`,`${target}.d.ts`,`${target}.d.mts`,`${target}.d.cts`,`${target}/index.ts`]){
                if(view.files.has(path)||view.derived.has(path)||view.admitGenerated(path)){resolved=path;break;}
                const provider=view.sourceProviders.get(path);
                if(deferNative&&provider!==undefined){
                  for(const output of provider.nativeOutputs)if(!provider.outputs.includes(output)||!output.startsWith('src/')&&!output.startsWith('public/')||output.split('/').includes('..'))throw new Error(`Invalid native source output: ${output}`);
                  // Never let Rust read an unproved leftover from an older
                  // mirror. CI regenerates this dependency before full lint.
                  rmSync(resolve(root,path),{force:true});
                  nativePending.add(path);deferred=true;break;
                }
                if(deriveGitDiscovery(view,path)){resolved=path;break;}
              }
              if(deferred)continue;
              if(resolved===undefined)missing.add(target);else visit(resolved);
            }
          };visit(selected);return {inputs:[...seen],missing:[...missing],mismatched:[...mismatched]};
        };
        const eligible=[],inputs=new Set();
        for(const file of roots) {
          const current=closure(file),mismatched=current.mismatched;
          if(mismatched.length>0||current.missing.length>0)console.log(`DEFERRED TO CI fast-lint ${file}: unverified inputs ${[...mismatched,...current.missing].join(', ')}`);
          else {eligible.push(file);for(const input of current.inputs)inputs.add(input);}
        }
        if(eligible.length>0) {
          const child=spawnSync(process.execPath,[resolve(root,'node_modules/oxlint/bin/oxlint'),'--threads=2','--disable-nested-config','-c',config,...eligible],{
            cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,WS_GIT_CHECK_ROOT:root,WS_GIT_CHECK_REV:tip,
              NODE_OPTIONS:[process.env.NODE_OPTIONS??'',`--import=${pathToFileURL(resolve(import.meta.dirname,'git-source-view.mjs')).href}`].join(' ')},
          });
          if(child.error!==undefined)throw child.error;
          if(child.status!==0)failures.push(child.stdout+child.stderr);
          const replaced=[...inputs].filter(path=>!view.matches(path));
          if(replaced.length>0)console.log(`DEFERRED TO CI fast-lint: inputs changed during checking: ${replaced.join(', ')}`);
          else console.log(`Fast lint passed on ${eligible.length} exact changed files`);
        }
        if(nativePending.size>0){
          console.log(`native-outputs report-only: ${nativePending.size} declared generated dependencies require the exact CI producer phase`);
          console.log('Gate-deferred: native-outputs');
        }
      } else {
        await deriveGitVocabulary(view);
        const debt=v.parse(v.object({rules:v.record(v.string(),v.unknown()),ignorePatterns:v.optional(v.array(v.string()),[]),jsPlugins:v.array(v.union([v.string(),v.object({name:v.string(),specifier:v.string()})]))}),json(view,'.oxlintrc.ratchet.json'));
        /** @type {Record<string,Record<string,number>>} */
        const counts={};
        for(const spec of debt.jsPlugins) {
          const path=typeof spec==='string'?spec:spec.specifier;
          const imported=v.parse(v.object({default:v.object({meta:v.optional(v.object({name:v.string()})),rules:v.record(v.string(),v.unknown())})}),await module(path));
          const prefix=typeof spec==='string'?imported.default.meta?.name:spec.name;
          if(prefix===undefined)throw new Error('Explicit JS rule namespace required');
          for(const [name,rule]of Object.entries(imported.default.rules)) {
            const key=`${prefix}/${name}`,setting=debt.rules[key];
            if(setting===undefined||setting==='off'||setting===0||['no-authored-html','no-shard-host-callback'].includes(name))continue;
            const options=Array.isArray(setting)?setting.slice(1):[];
            v.parse(v.looseObject({create:v.function()}),rule);
            const selected=roots.filter(file=>file.startsWith('src/')&&!debt.ignorePatterns.some(pattern=>matchesGlob(file,pattern)));
            for(const file of selected) {
              const current=gitRuleCount(/** @type {Parameters<typeof gitRuleCount>[0]} */(rule),resolve(root,file),view.read(file).toString('utf8'),options,root);
              (counts[key]??={})[file]=current;
            }
          }
        }
        if(phase==='ratchet-counts') {console.log(JSON.stringify(counts));return;}
        // A separate reader pins predecessor metadata too; current modules never
        // borrow dirty policy or confuse changed dependency data with old debt.
        const missing=roots.filter(file=>Object.entries(counts).some(([key,rows])=>!hard.has(key)&&rows[file]>0&&!Object.hasOwn(policy[key]??{},file)));
        /** @type {Record<string,Record<string,number>>} */
        let previous={};
        if(missing.length>0) {
          const child=spawnSync(process.execPath,[resolve(import.meta.filename),root,base,base,'ratchet-counts',JSON.stringify(missing)],{
            cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,
          });
          if(child.error!==undefined)throw child.error;
          if(child.status!==0)throw new Error(`Predecessor ratchet failed: ${child.stderr}`);
          previous=JSON.parse(child.stdout);
        }
        for(const [key,rows]of Object.entries(counts))for(const [file,current]of Object.entries(rows)) {
          const limit=policy[key]?.[file]??(hard.has(key)?0:previous[key]?.[file]??0);
          if(current>limit)failures.push(`${file}: ${key} was ${limit}, now ${current}`);
        }
      }
    } else if(phase==='deleted-paths') {
      view.prime([...view.files.keys()].filter(path=>/^(?:src|scripts|test|lint|admin|api|drafts|vite)\/.*\.(?:json|[cm]?[jt]sx?|py|sh)$/u.test(path)
        &&!/^src\/shards\/[^/]+-legacy\//u.test(path)&&!path.startsWith('test/fixtures/')));
      const {deletedReferences}=/** @type {typeof import('./push-checks.mjs')} */(await module('scripts/push-checks.mjs'));
      failures.push(...deletedReferences(root,paths));
    } else if(phase==='guards') {
      const {comparePlatformList,PLATFORM_LISTS}=/** @type {typeof import('./check-platform-ratchets.mjs')} */(await module('scripts/check-platform-ratchets.mjs'));
      const {ratchetApprovalFailures}=/** @type {typeof import('./ratchet-approval.mjs')} */(await module('scripts/ratchet-approval.mjs'));
      const policy=json(view,'lint/ratchet.json');
      if(view.files.has('scripts/check-spelled-paths.mjs')) {
        const {spelledPathFailures}=/** @type {typeof import('./check-spelled-paths.mjs')} */(await module('scripts/check-spelled-paths.mjs'));
        view.prime([...view.files.keys()].filter(path=>/^src\/(?:engine|game)\/isolated-[^/]+\.test\.ts$|^scripts\/.*\.[cm]?[jt]s$|^src\/shards\/[^/]+\/(?:data|look)\/map\.json$/u.test(path)));
        failures.push(...spelledPathFailures(view.files,path=>view.read(path).toString('utf8')));
      }
      // The folder rule of check-paths, over committed paths: a new file in a shard's root needs the layout's word.
      const touchedShards=new Set(paths.flatMap(path=>/^src\/shards\/([^/]+)\//u.exec(path)?.[1]??[]));
      if(touchedShards.size>0&&view.files.has('lint/shard-layout.json')) {
        const {checkShardLayout,shardEntries}=/** @type {typeof import('./check-shards.mjs')} */(await module('scripts/check-shards.mjs'));
        const {producers}=json(view,'scripts/source-generation-outputs.json',{producers:{}});
        const generated=new Set(Object.values(producers).flat());
        const outputs=Object.fromEntries([...touchedShards].flatMap(slug=>{
          const rows=json(view,`src/shards/${slug}/outputs.json`).outputs;
          return Array.isArray(rows)?[[slug,rows.map(row=>row.slug)]]:[];
        }));
        const entries=shardEntries([...view.files.keys()].filter(path=>!generated.has(path)),touchedShards);
        failures.push(...checkShardLayout(entries,json(view,'lint/shard-layout.json'),outputs).map(row=>`src/shards/${row}`));
      }
      // What derived-docs walks first: a package's exports. Only a manifest or the lockfile can change that shape.
      if(view.files.has('scripts/docs/read-shardfile-reference.mjs')&&paths.some(path=>/^(?:pnpm-lock\.yaml|src\/[^/]+\/package\.json|scripts\/docs\/(?:sdk-schemas|read-shardfile-reference|schema-reference)\.mjs)$/u.test(path))) {
        const child=spawnSync(process.execPath,['--import','./scripts/sim-node-loader.mjs','scripts/docs/read-shardfile-reference.mjs'],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,timeout:15_000});
        if(child.error===undefined&&child.status!==0)failures.push(`scripts/docs/sdk-schemas.mjs: the schema reference refused: ${child.stderr}`);
      }
      if(view.files.has('scripts/format-lock.mjs')) {
        const {formatLockFailures,formatTagFailures,isFormatLockInput}=/** @type {typeof import('./format-lock.mjs')} */(await module('scripts/format-lock.mjs'));
        if(paths.some(isFormatLockInput)) {
          const read=(/** @type {string} */ path)=>view.files.has(path)?view.read(path).toString('utf8'):undefined;
          const local=formatLockFailures(read,[...view.files.keys()].filter(path=>/^\.github\/workflows\/[^/]+\.yml$/u.test(path)));
          failures.push(...local,...(local.length>0?[]:formatTagFailures(read)));
        }
      }
      // GS5 (G798): each committed gen:source table the push touches (an input or the table) equals a fresh run over
      // the tip's own inputs.
      if(view.files.has('scripts/gen-source.mjs')&&paths.length>0) {
        const {genSource}=/** @type {typeof import('./gen-source.mjs')} */(await module('scripts/gen-source.mjs'));
        try {await genSource(root,{check:true,committed:true,changed:paths});}
        catch(error) {failures.push(error instanceof Error?error.message:String(error));}
      }
      const commits=execFileSync('git',['rev-list','--reverse',`${base}..${tip}`],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
      const approvals=[];
      const NET_LIST='lint/engine-side-edges.json';
      const compareList=(path,before,after)=>{
        const a=resolve(temporary,'before.json'),b=resolve(temporary,'after.json');
        if(before.files.has(path))writeFileSync(a,before.read(path));
        if(after.files.has(path))writeFileSync(b,after.read(path));
        failures.push(...comparePlatformList(path,a,b,undefined,{
          before:file=>before.files.has(file)?before.read(file).toString('utf8'):undefined,
          after:file=>after.files.has(file)?after.read(file).toString('utf8'):undefined,
        }));
        rmSync(a,{force:true});rmSync(b,{force:true});
      };
      for(const commit of commits) {
        const before=gitSourceView(root,`${commit}^`),after=gitSourceView(root,commit);
        const message=execFileSync('git',['show','-s','--format=%B',commit],{cwd:root,encoding:'utf8'});
        const content=message.trimEnd().replace(/\n\nAssisted-by:[^\n]+$/u,'').replaceAll(/\n[ \t]+/gu,' ');
        const footer=content.split(/\n\s*\n/u).at(-1)??'';
        approvals.push(...footer.split('\n').filter(line=>line.startsWith('Ratchet-Approved:')));
        for(const path of PLATFORM_LISTS)if(path!==NET_LIST&&before.files.get(path)!==after.files.get(path)) compareList(path,before,after);
      }
      // Lanes share one tree and this table is one file, so a whole-file commit can carry a peer's rows up and the
      // next commit bring them down. Only the published step can't rise (J122 lanes): compare base to tip, once.
      const published=gitSourceView(root,base);
      if(published.files.get(NET_LIST)!==view.files.get(NET_LIST)) compareList(NET_LIST,published,view);
      // G768 checks the net published candidate. A later exact approval can
      // repair a local receipt without rewriting any commit or reusing a
      // partial increment to approve a larger final allowance.
      const priorPolicy=json(gitSourceView(root,base),'lint/ratchet.json');
      // A newly introduced rule's initial per-file rows seed the ratchet.
      // Older candidates never inherit a rule from the working-tree checker.
      const comparedPolicy=Object.fromEntries(Object.entries(policy).filter(([rule])=>!rule.startsWith('wildshard/')||Object.keys(priorPolicy[rule]??{}).length>0));
      failures.push(...ratchetApprovalFailures(priorPolicy,comparedPolicy,
        `Exact outgoing policy approvals\n\n${approvals.join('\n')}`));
    } else if(phase==='census') {
      // The census ratchets of CI's prepare job, over the tip's blobs, last so they spend only what the budget leaves.
      // One that runs out of time is CI's, not a verdict.
      if(view.files.has('scripts/sort-sides.mjs')&&view.files.has('scripts/check-sim-players.mjs')&&paths.some(path=>/^(?:src\/(?:engine|game|sdk|sharddev)|lint)\//u.test(path))) {
        const census=async(/** @type {string} */ script)=>{
          const child=spawn(process.execPath,[resolve(root,'scripts/sort-sides.mjs'),'--view',tip,script],{cwd:root,timeout:25_000,stdio:['ignore','pipe','pipe']});
          const closed=once(child,'close'),[stdout,stderr]=await Promise.all([text(child.stdout),text(child.stderr)]);
          await closed;
          return child.exitCode===0||child.signalCode!==null?'':`${stdout}${stderr}`;
        };
        const verdicts=await Promise.all(['scripts/check-engine-sides.mjs','scripts/check-sim-players.mjs'].map(census));
        failures.push(...verdicts.filter(verdict=>verdict!==''));
      }
    } else throw new Error('Unknown committed fast-check phase');
    if(failures.length>0)throw new Error(failures.join('\n'));
    if(phase!=='fast-lint')console.log(`${phase}: exact committed inputs passed`);
  } finally {rmSync(resolve(root,`.${basename(temporary)}.json`),{force:true});rmSync(temporary,{recursive:true,force:true});}
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [root,base,tip,phase,listing]=process.argv.slice(2);
  if(root===undefined||base===undefined||tip===undefined||phase===undefined||listing===undefined)throw new Error('Expected root, base, tip, phase and JSON paths');
  await committedFastChecks(resolve(root),base,tip,phase,JSON.parse(listing));
}
