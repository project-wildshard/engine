// DS16c (Jake, 2026-11-10): "Fucking cheap 5 seconds check before in queue."
// Refuse an enqueue in seconds when its full ~4-minute gate is certain to bounce
// on bookkeeping. Refuse only on a certain problem; anything unsure is a warning.
// The gate keeps every one of its own checks: this only fails earlier.
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const STAMPS=['scripts/renderer-revision.json','scripts/validation-revision.json'];
const DURATIONS=new Set(['test/durations.json','test/durations-ring1.json','test/durations-source.json']);
const SOURCE='test/durations-source.json';
// The gate's own new-test pattern (scripts/push-test-timings.mjs missingTestTimings).
const TEST_FILE=/^(?:src|test)\/[\s\S]+\.test\.[cm]?[jt]sx?$/u;
const JOURNAL_MIN_LINES=30;
const isJournal=(/** @type {string} */path)=>/^project\/journal\/.+\.md$/u.test(path)&&!path.endsWith('/README.md');

/** @typedef {{check:string,message:string,fix?:string}} Finding */
/** @typedef {{sha:string,upstream:string|null,base:string|null,fresh:boolean,refusals:Finding[],warnings:Finding[],steps:Record<string,number>,seconds:number}} Report */

/** @param {string} cwd @param {string[]} args @param {number} [timeout] */
const git=(cwd,args,timeout=30_000)=>execFileSync('git',args,{cwd,encoding:'utf8',timeout,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
/** @param {unknown} error */
const reason=error=>(error instanceof Error?error.message:String(error)).split('\n')[0]?.slice(0,300)??'unknown';

/** Environment-gated skips decide the timing step. A variable the queue's gate
 * cannot carry (scripts/push-environment.mjs) and no gate/Vitest setup file
 * names is certainly absent there; anything else stays unknown. The preflight
 * runs from the checkout it checks, so its own gate files are that checkout's.
 * @returns {Promise<(name:string)=>boolean>} */
async function gateAbsence(){
 const engine=resolve(import.meta.dirname,'..');
 const {gateEnvironment}=await import('./push-environment.mjs');
 const named=['vitest.config.ts','test/setup.ts','scripts/vitest-cpu.ts','scripts/vitest-tmp.ts','scripts/vitest-lane.ts','scripts/vitest-environments.ts',
  'scripts/push-environment.mjs','.githooks/push-checks.mjs','.githooks/run-checks.mjs','.githooks/pre-push']
  .map(file=>{try{return readFileSync(join(engine,file),'utf8');}catch{return '';}}).join('\n');
 // Vitest and Vite set these themselves in every worker.
 const runtime=new Set(['VITEST','VITEST_MODE','VITEST_POOL_ID','VITEST_WORKER_ID','NODE_ENV','TEST','MODE','DEV','PROD','SSR','BASE_URL','CI','GITHUB_ACTIONS']);
 return name=>!runtime.has(name)&&!name.startsWith('VITE')&&!(name in gateEnvironment({[name]:'1'}))&&!named.includes(name);
}

/** @typedef {{line:number,kind:'test'|'suite',skip:'certain'|'unknown'|'none'}} Registration */

const HOOKS=new Set(['beforeAll','afterAll','beforeEach','afterEach','onTestFinished','onTestFailed']);
/** Statement kinds that declare without registering anything at load time. */
const DECLARATIONS=new Set(['ImportDeclaration','VariableDeclaration','FunctionDeclaration','ClassDeclaration','TSTypeAliasDeclaration','TSInterfaceDeclaration','TSEnumDeclaration','TSModuleDeclaration','EmptyStatement']);

/** Static Vitest registrations with their effective skip state in the gate.
 * `sound` is false when anything else could register a test at load time (a
 * helper call at file or suite level), so "every test is skipped" is unproven.
 * @param {string} text @param {(name:string)=>boolean} absent
 * @returns {Promise<{found:Registration[],sound:boolean}|null>} */
export async function registrations(text,absent){
 /** @type {{parseAst:(code:string,options:{lang:'ts'|'tsx'|'js'})=>any}} */
 let parser;
 try{parser=await import('rolldown/parseAst');}catch{return null;}
 /** @type {any} */let ast;
 try{ast=parser.parseAst(text,{lang:'tsx'});}catch{try{ast=parser.parseAst(text,{lang:'ts'});}catch{return null;}}
 const lineAt=(/** @type {number} */offset)=>text.slice(0,offset).split('\n').length;
 /** @type {Map<string,string>} top-level const NAME = process.env.X (no default) */
 const envConstants=new Map();
 /** @param {any} node @returns {string|null} */
 const envRead=node=>{
  if(node?.type!=='MemberExpression')return null;
  const object=node.object;
  if(object?.type!=='MemberExpression'||object.object?.type!=='Identifier'||object.object.name!=='process'||object.property?.name!=='env'||object.computed)return null;
  if(!node.computed&&node.property?.type==='Identifier')return node.property.name;
  if(node.computed&&node.property?.type==='Literal'&&typeof node.property.value==='string')return node.property.value;
  return null;
 };
 for(const statement of ast.body){
  const declaration=statement.type==='ExportNamedDeclaration'?statement.declaration:statement;
  if(declaration?.type!=='VariableDeclaration'||declaration.kind!=='const')continue;
  for(const row of declaration.declarations){
   const name=envRead(row.init);
   if(row.id?.type==='Identifier'&&name!==null)envConstants.set(row.id.name,name);
  }
 }
 // A constant shadowed anywhere (a local, a parameter) is not provably the env read.
 /** @type {Map<string,number>} */const declared=new Map();
 /** @param {any} pattern */
 const bind=pattern=>{
  if(pattern===null||typeof pattern!=='object')return;
  if(pattern.type==='Identifier'){declared.set(pattern.name,(declared.get(pattern.name)??0)+1);return;}
  for(const [key,value] of Object.entries(pattern))if(key!=='typeAnnotation'&&key!=='decorators'&&value!==null&&typeof value==='object')bind(value);
 };
 /** @param {any} node */
 const declarations=node=>{
  if(node===null||typeof node!=='object')return;
  if(Array.isArray(node)){for(const child of node)declarations(child);return;}
  if(node.type==='VariableDeclarator')bind(node.id);
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){bind(node.params);if(node.id)bind(node.id);}
  if(node.type==='CatchClause')bind(node.param);
  if(node.type==='ImportSpecifier'||node.type==='ImportDefaultSpecifier'||node.type==='ImportNamespaceSpecifier')bind(node.local);
  if(node.type==='ClassDeclaration'&&node.id)bind(node.id);
  for(const [key,value] of Object.entries(node))if(key!=='parent'&&value!==null&&typeof value==='object')declarations(value);
 };
 declarations(ast.body);
 for(const name of envConstants.keys())if((declared.get(name)??0)!==1)envConstants.delete(name);
 /** Absent in the gate, certainly; null when not provable.
  * @param {any} node @returns {string|null} */
 const absentVariable=node=>{
  const name=node?.type==='Identifier'?envConstants.get(node.name)??null:envRead(node);
  return name!==null&&absent(name)?name:null;
 };
 /** true: certainly true in the gate; false: certainly false; null: unknown.
  * @param {any} node @returns {boolean|null} */
 const truth=node=>{
  if(node===null||node===undefined)return null;
  if(node.type==='ParenthesizedExpression'||node.type==='TSNonNullExpression')return truth(node.expression);
  if(node.type==='Literal'&&typeof node.value==='boolean')return node.value;
  if(node.type==='UnaryExpression'&&node.operator==='!'){const inner=truth(node.argument);return inner===null?null:!inner;}
  if(absentVariable(node)!==null)return false;
  if(node.type==='CallExpression'&&node.callee?.type==='Identifier'&&node.callee.name==='Boolean'&&node.arguments.length===1)return truth(node.arguments[0]);
  if(node.type==='BinaryExpression'&&['===','!==','==','!='].includes(node.operator)){
   const isUndefined=(/** @type {any} */side)=>side?.type==='Identifier'&&side.name==='undefined'||side?.type==='Literal'&&side.value===null&&['==','!='].includes(node.operator);
   const typeofUndefined=(/** @type {any} */a,/** @type {any} */b)=>a?.type==='UnaryExpression'&&a.operator==='typeof'&&absentVariable(a.argument)!==null&&b?.type==='Literal'&&b.value==='undefined';
   const equal=node.operator.startsWith('=');
   if(isUndefined(node.right)&&absentVariable(node.left)!==null||isUndefined(node.left)&&absentVariable(node.right)!==null)return equal;
   if(typeofUndefined(node.left,node.right)||typeofUndefined(node.right,node.left))return equal;
  }
  if(node.type==='LogicalExpression'){
   const left=truth(node.left),right=truth(node.right);
   if(node.operator==='||')return left===true||right===true?true:left===false&&right===false?false:null;
   if(node.operator==='&&')return left===false||right===false?false:left===true&&right===true?true:null;
  }
  return null;
 };
 /** Peel a registration chain: test.skipIf(c).each(t)('name', fn).
  * @param {any} callee @returns {{root:string,skip:'certain'|'unknown'|'none'}|null} */
 const chain=callee=>{
  /** @type {'certain'|'unknown'|'none'} */let skip='none';
  const raise=(/** @type {'certain'|'unknown'} */value)=>{if(value==='certain'||skip==='none')skip=value;};
  let node=callee;
  for(;;){
   if(node?.type==='Identifier')return ['test','it','describe','suite'].includes(node.name)?{root:node.name,skip}:null;
   if(node?.type==='MemberExpression'&&!node.computed&&node.property?.type==='Identifier'){
    if(['skip','todo'].includes(node.property.name))raise('certain');
    else if(!['only','concurrent','sequential','shuffle','fails'].includes(node.property.name))return null;
    node=node.object;continue;
   }
   if(node?.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&!node.callee.computed){
    const modifier=node.callee.property?.name;
    if(modifier==='skipIf'||modifier==='runIf'){
     const value=truth(node.arguments[0]);
     const skipped=value===null?null:modifier==='skipIf'?value:!value;
     if(skipped===true)raise('certain');else if(skipped===null)raise('unknown');
    }else if(!['each','for'].includes(modifier))return null;
    node=node.callee.object;continue;
   }
   return null;
  }
 };
 let sound=true;
 /** Only declarations, registrations and hooks at file or suite level.
  * @param {any[]} statements */
 const level=statements=>{
  for(const statement of statements){
   const inner=statement.type==='ExportNamedDeclaration'?statement.declaration:statement;
   if(inner===null||inner===undefined||DECLARATIONS.has(inner.type))continue;
   const call=inner.type==='ExpressionStatement'?inner.expression:null;
   if(call?.type==='CallExpression'&&(chain(call.callee)!==null||call.callee?.type==='Identifier'&&HOOKS.has(call.callee.name)))continue;
   sound=false;
  }
 };
 level(ast.body);
 /** @type {Registration[]} */const found=[];
 /** @param {any} node @param {'certain'|'unknown'|'none'} inherited */
 const walk=(node,inherited)=>{
  if(node===null||typeof node!=='object')return;
  if(Array.isArray(node)){for(const child of node)walk(child,inherited);return;}
  if(node.type==='CallExpression'){
   const registration=chain(node.callee);
   if(registration!==null){
    const skip=inherited==='certain'||registration.skip==='certain'?'certain':inherited==='unknown'||registration.skip==='unknown'?'unknown':'none';
    const kind=registration.root==='test'||registration.root==='it'?'test':'suite';
    found.push({line:lineAt(node.start),kind,skip});
    if(kind==='suite')for(const argument of node.arguments){
     if(!['ArrowFunctionExpression','FunctionExpression'].includes(argument?.type))continue;
     if(argument.body?.type==='BlockStatement')level(argument.body.body);else sound=false;
    }
    walk(node.callee,inherited);walk(node.arguments,skip);return;
   }
  }
  for(const [key,value] of Object.entries(node))if(key!=='parent'&&value!==null&&typeof value==='object')walk(value,inherited);
 };
 walk(ast.body,'none');
 return {found,sound};
}

/** The text of a test file's relative imports, one level deep, at a commit; null
 * when one cannot be read (then an env variable might be set there).
 * @param {string} root @param {string} sha @param {string} file @param {string} text */
function relativeImports(root,sha,file,text){
 const parts=[];
 for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/gu)){
  const target=join(dirname(file),match[1]).replaceAll('\\','/');
  let body=null;
  for(const candidate of [target,`${target}.ts`,`${target}.mjs`,`${target}.js`,`${target}/index.ts`]){
   try{body=git(root,['show',`${sha}:${candidate}`]);break;}catch{ /* Try the next resolution. */ }
  }
  if(body===null)return null;
  parts.push(body);
 }
 return parts.join('\n');
}

/** Replay each commit the way the queue's `git rebase` will, without a checkout:
 * the sequencer's own list (--reverse --topo-order --right-only --cherry-pick,
 * merges dropped), each picked with its parent as the merge base.
 * Returns the first commit whose non-stamp paths conflict, or null when clean.
 * @param {string} root @param {string} upstream @param {string} sha @param {()=>number} remaining */
function simulateRebase(root,upstream,sha,remaining){
 const commits=git(root,['rev-list','--reverse','--topo-order','--no-merges','--right-only','--cherry-pick',`${upstream}...${sha}`]).split('\n').filter(Boolean);
 let ours=upstream;
 for(const commit of commits){
  if(remaining()<=0)throw new Error(`deadline reached after replaying part of ${commits.length} commits`);
  const result=spawnSync('git',['merge-tree','--write-tree','--name-only','--no-messages','-z',`--merge-base=${commit}^`,ours,commit],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,timeout:remaining()});
  if(result.status!==0&&result.status!==1)throw new Error(`git merge-tree unavailable: ${result.stderr.trim()||(result.error?.message??'no output')}`);
  const [tree,...paths]=result.stdout.split('\0');
  if(tree===undefined||!/^[a-f0-9]{40,64}$/u.test(tree))throw new Error('git merge-tree gave no tree');
  if(result.status===1){
   // The queue regenerates the two official stamps itself (push-queue-rebase.mjs).
   const conflicts=[...new Set(paths.filter(path=>path!==''&&!STAMPS.includes(path)))];
   if(conflicts.length>0)return {commit,conflicts,count:commits.length};
  }
  ours=tree;
 }
 return null;
}

/** Added lines per file between two commits.
 * @param {string} root @param {string} base @param {string} sha @param {string} file */
function addedLines(root,base,sha,file){
 const lines=new Set();
 for(const match of git(root,['diff','-U0','--no-color',base,sha,'--',file]).matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gmu)){
  const start=Number(match[1]),count=match[2]===undefined?1:Number(match[2]);
  for(let line=start;line<start+count;line++)lines.add(line);
 }
 return lines;
}

/** Run every cheap check. Never throws: a check that cannot run is a warning.
 * A hard deadline (default 15 s; a normal change takes 1-4 s) turns any slow
 * step into a warning, never a wait.
 * @param {string} root @param {{sha?:string,fetch?:boolean,budgetMs?:number}} [options] @returns {Promise<Report>} */
export async function preflight(root,options={}){
 const began=performance.now();
 /** @type {Report} */
 const report={sha:'',upstream:null,base:null,fresh:false,refusals:[],warnings:[],steps:{},seconds:0};
 /** @param {string} name @param {()=>unknown} body */
 const step=async(name,body)=>{
  const at=performance.now();
  try{await body();}catch(error){report.warnings.push({check:name,message:`could not run (${reason(error)}); not refusing`});}
  finally{report.steps[name]=Math.round(performance.now()-at);}
 };
 try{
  report.sha=git(root,['rev-parse','--verify',`${options.sha??'HEAD'}^{commit}`]);
 }catch(error){report.warnings.push({check:'target',message:`could not resolve the target commit (${reason(error)}); not refusing`});report.seconds=(performance.now()-began)/1000;return report;}
 const sha=report.sha,head=git(root,['rev-parse','HEAD']);
 const deadline=began+(options.budgetMs??15_000),remaining=()=>Math.max(0,Math.floor(deadline-performance.now()));
 await step('fetch',()=>{
  if(options.fetch===false)return;
  git(root,['fetch','--quiet','--no-tags','origin','main'],Math.min(5_000,remaining()));report.fresh=true;
 });
 if(!report.fresh&&options.fetch!==false)report.warnings.push({check:'fetch',message:'origin main was not refreshed, so conflicts against it are warnings only'});
 if(options.fetch===false)report.fresh=true;
 try{report.upstream=git(root,['rev-parse','--verify','refs/remotes/origin/main^{commit}']);}catch{
  report.warnings.push({check:'upstream',message:'no origin/main to compare against; not refusing'});report.seconds=(performance.now()-began)/1000;return report;
 }
 const upstream=report.upstream;
 if(spawnSync('git',['merge-base','--is-ancestor',sha,upstream],{cwd:root}).status===0){report.seconds=(performance.now()-began)/1000;return report;}
 const base=report.base=git(root,['merge-base',upstream,sha]);
 const changed=git(root,['diff','--no-renames','--name-status','-z',base,sha]).split('\0');
 /** @type {Map<string,string>} */const status=new Map();
 for(let index=0;index+1<changed.length;index+=2)if(changed[index]!==''&&changed[index+1]!==undefined)status.set(changed[index+1],changed[index]);
 const atTarget=head===sha;
 /** Tracked bytes at these paths equal the target commit's. @param {string[]} paths */
 const clean=paths=>atTarget&&git(root,['status','--porcelain','--untracked-files=no','--',...paths])==='';

 // 6 and 2: the queue's private rebase stops on any non-stamp conflict.
 await step('conflicts',()=>{
  const conflict=simulateRebase(root,upstream,sha,remaining);
  if(conflict===null)return;
  const short=conflict.commit.slice(0,8),subject=git(root,['log','-1','--format=%s',conflict.commit]);
  const durations=conflict.conflicts.filter(path=>DURATIONS.has(path));
  const fix=durations.includes(SOURCE)
   ?`git pull --rebase origin main; on the ${SOURCE} conflict run \`node scripts/push-preflight.mjs merge-durations\` (keeps both sides' observations), \`git add ${SOURCE}\`, \`git rebase --continue\`; then enqueue again`
   :'git pull --rebase origin main, resolve these paths yourself, then enqueue again';
  const finding={check:'conflicts',message:`your commit ${short} "${subject}" conflicts with origin/main ${upstream.slice(0,8)} on ${conflict.conflicts.join(', ')}; the queue's rebase stops there ("Queue snapshot rebase conflict: ... owner must fix")`,fix};
  (report.fresh?report.refusals:report.warnings).push(finding);
 });

 // 1: the gate's own missingTestTimings, over the range the queue will publish.
 /** @type {string[]|null} */let missing=null;
 const addedTests=[...status].filter(([file,kind])=>kind==='A'&&TEST_FILE.test(file)).map(([file])=>file);
 const liftPending=status.has('test/lift-pending.json');
 await step('timings',()=>{
  if(addedTests.length===0&&!liftPending){missing=[];return;}
  // Discovery and clocks are read from the working tree: it must hold the target's bytes.
  if(!clean(['.'])){
   report.warnings.push({check:'timings',message:`new test files (${addedTests.join(', ')}) not checked: HEAD is not the target or tracked files are edited; the gate will check them`});return;
  }
  // The gate's own check, in a child bounded by the deadline (it lists Vitest's files twice).
  const program=`const {missingTestTimings}=await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname,'push-test-timings.mjs')).href)});process.stdout.write(JSON.stringify(missingTestTimings(process.argv[1],process.argv[2])));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',program,`refs/heads/main ${sha} refs/heads/main ${base}`,root],{cwd:root,encoding:'utf8',timeout:remaining(),killSignal:'SIGKILL',maxBuffer:16*1024*1024});
  if(child.status!==0){const last=child.stderr.trim().split('\n').at(-1);throw new Error(child.error?.message??(last===undefined||last===''?`exit ${child.status}`:last));}
  /** @type {{file:string,rings:string[]}[]} */const listed=JSON.parse(child.stdout);
  // A file origin/main already has is not new to the queue's rebased range.
  const rows=listed.filter(row=>spawnSync('git',['cat-file','-e',`${upstream}:${row.file}`],{cwd:root}).status!==0);
  missing=rows.map(row=>row.file);
  if(rows.length>0)report.refusals.push({check:'timings',
   message:`new test files without committed timings: ${rows.map(row=>`${row.file} (${row.rings.map(ring=>ring==='1'?'Ring 1':'full').join(' + ')})`).join(', ')}; the gate's timing step refuses after the full suite ("New test files need committed timings")`,
   fix:'node scripts/push-preflight.mjs timings (runs only these files with the gate\'s timing reporter and records them), then commit test/durations.json test/durations-ring1.json test/durations-source.json with a project/journal/ line (the record is 30+ lines, so the D25 pre-commit rule asks for one)'});
 });

 // 3: a new test file the gate would wholly skip can never get a clock: the
 // timing step crashes with `ValiError: Expected "passed" but received "skipped"`.
 await step('skips',async()=>{
  const files=[...status].filter(([file,kind])=>(kind==='A'||kind==='M')&&TEST_FILE.test(file)).map(([file])=>file);
  if(files.length===0)return;
  const absent=await gateAbsence();
  for(const file of files){
   const text=git(root,['show',`${sha}:${file}`]);
   if(!/\b(?:skip|skipIf|runIf|todo)\b/u.test(text))continue;
   // A local module this file imports could set the variable itself.
   const imported=relativeImports(root,sha,file,text);
   const parsed=await registrations(text,name=>imported!==null&&absent(name)&&!imported.includes(name));
   if(parsed===null){report.warnings.push({check:'skips',message:`${file}: could not parse its tests; not refusing`});continue;}
   const found=parsed.found,tests=found.filter(row=>row.kind==='test');
   const whole=parsed.sound&&tests.length>0&&tests.every(row=>row.skip==='certain');
   const needsClock=missing?.includes(file)??false;
   if(whole&&needsClock){
    report.refusals.push({check:'skips',message:`${file} is new and every test in it is skipped in the queue's gate (line ${tests.map(row=>row.line).join(', ')}): its timing step crashes with ValiError "Expected \\"passed\\" but received \\"skipped\\""`,
     fix:'make it run in the gate, or make it a named proof run by name (like test/hud-layout-browser.proof.mjs), then enqueue again'});
    continue;
   }
   if(whole&&status.get(file)==='A'){report.warnings.push({check:'skips',message:`${file} is new and wholly skipped in the gate; if it needs a clock, the timing step will crash`});continue;}
   const fresh=addedLines(root,base,sha,file);
   const added=found.filter(row=>row.skip!=='none'&&fresh.has(row.line));
   if(added.length>0)report.warnings.push({check:'skips',message:`${file} adds ${added.length} skipped or conditional test(s) (line ${added.map(row=>row.line).join(', ')}); the gate passes a skip in a file that already has a clock, but it is a test nobody runs`});
  }
 });

 // 5: stale official stamps. The queue regenerates and commits both after its
 // rebase (push-queue-rebase.mjs), so they cannot bounce a job: warning only.
 await step('stamps',async()=>{
  if(git(root,['ls-tree','--name-only',sha,'--',...STAMPS]).split('\n').filter(Boolean).length!==STAMPS.length)return;
  if(!clean(['.'])){report.warnings.push({check:'stamps',message:'not checked: HEAD is not the target or tracked files are edited'});return;}
  const {rendererRevision}=await import('./renderer-revision.mjs');
  const {shardfileValidationRevision}=await import('./shardfile-validation-revision.mjs');
  /** @type {[string,(root:string)=>string][]} */
  const sources=[['scripts/renderer-revision.json',rendererRevision],['scripts/validation-revision.json',shardfileValidationRevision]];
  const stale=[];
  for(const [stamp,compute] of sources){
   /** @type {unknown} */const committed=JSON.parse(git(root,['show',`${sha}:${stamp}`])).revision;
   if(committed!==compute(root))stale.push(stamp);
  }
  if(stale.length>0)report.warnings.push({check:'stamps',message:`stale ${stale.join(', ')}; the queue regenerates and commits them after its rebase, so this does not bounce. To commit them yourself: node scripts/gen.mjs --inputs-only`});
 });

 // 4: the journal rule is a pre-commit check only. The queue's rebase runs no
 // pre-commit hook and pre-push has no journal check, so it cannot bounce a job.
 await step('journal',()=>{
  for(const commit of git(root,['rev-list','--no-merges',`${base}..${sha}`]).split('\n').filter(Boolean)){
   const rows=git(root,['show','--numstat','--format=','--no-renames',commit]).split('\n').filter(Boolean).map(line=>line.split('\t'));
   const lines=rows.filter(([added,deleted,path])=>path!==undefined&&!isJournal(path)&&added!=='-'&&deleted!=='-').reduce((sum,[added,deleted])=>sum+Number(added)+Number(deleted),0);
   if(lines>=JOURNAL_MIN_LINES&&!rows.some(row=>row[2]!==undefined&&isJournal(row[2])))
    report.warnings.push({check:'journal',message:`commit ${commit.slice(0,8)} changes ${lines} lines with no project/journal/ entry (the pre-commit rule, D25); the queue does not check it`});
  }
 });
 report.seconds=(performance.now()-began)/1000;
 return report;
}

/** @param {Report} report */
export function formatReport(report){
 const out=[`push preflight ${report.refusals.length>0?'REFUSED':'ok'} in ${report.seconds.toFixed(2)} s for ${report.sha.slice(0,12)} on origin/main ${report.upstream?.slice(0,8)??'?'} (${Object.entries(report.steps).map(([name,ms])=>`${name} ${ms} ms`).join(', ')})`];
 for(const row of report.refusals)out.push(`  X ${row.check}: ${row.message}`,...(row.fix===undefined?[]:[`    fix: ${row.fix}`]));
 for(const row of report.warnings)out.push(`  ! ${row.check}: ${row.message}`);
 return out.join('\n');
}

/** @param {string} lane @param {string} message */
function receipt(lane,message){
 const file=resolve(process.env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
 const name=/^[a-z][a-z0-9_-]*$/u.test(lane)?lane:'push-queue';
 try{mkdirSync(dirname(file),{recursive:true});appendFileSync(file,`${new Date().toISOString().slice(11,16)} ${name} push preflight ${message.replaceAll(/\s+/gu,' ').slice(0,1000)}\n`);}catch(error){console.error('Push preflight receipt unavailable',error);}
}

/** The enqueue gate. Returns the record a captured job carries, or null to refuse.
 * WS_PREFLIGHT_SKIP=<reason> is the logged escape hatch: checks still run and
 * are recorded, but nothing is refused.
 * @param {string} source @param {{commit?:string,checkOnly:boolean,lane:string,skip?:string}} options */
export async function admitEnqueue(source,options){
 const skip=options.skip;
 if(skip!==undefined&&!/[a-z].{7,}/iu.test(skip.trim())){
  console.error('push preflight: WS_PREFLIGHT_SKIP needs a written reason (8+ characters), e.g. WS_PREFLIGHT_SKIP="durations conflict is VB18 test fixture"');
  return null;
 }
 /** @type {Report} */let report;
 try{report=await preflight(source,{sha:options.commit});}catch(error){
  console.error(`push preflight could not run (${reason(error)}); enqueueing without it`);
  return {sha:'',seconds:0,refused:[],warnings:[`preflight: could not run (${reason(error)})`]};
 }
 console.error(formatReport(report));
 const record={sha:report.sha,seconds:Number(report.seconds.toFixed(3)),refused:report.refusals.map(row=>`${row.check}: ${row.message}`),warnings:report.warnings.map(row=>`${row.check}: ${row.message}`).slice(0,20),...(skip===undefined?{}:{override:skip.trim().slice(0,300)}),...(options.checkOnly?{checkOnly:true}:{})};
 if(report.refusals.length===0)return record;
 if(skip!==undefined){
  receipt(options.lane,`override ${report.sha.slice(0,8)} (WS_PREFLIGHT_SKIP="${skip.trim()}"): would refuse ${report.refusals.map(row=>row.check).join(', ')}`);
  console.error(`push preflight: OVERRIDDEN by WS_PREFLIGHT_SKIP="${skip.trim()}"; this is recorded in the job and the lane receipts`);
  return record;
 }
 // A check-only job collects gate evidence (for example new-test clocks); it publishes nothing.
 if(options.checkOnly){console.error('push preflight: --check-only publishes nothing, so these refusals are warnings');return record;}
 receipt(options.lane,`refused ${report.sha.slice(0,8)} in ${report.seconds.toFixed(1)} s: ${report.refusals.map(row=>`${row.check}: ${row.message}`).join(' | ')}`);
 console.error('push preflight: not enqueued. Fix the above and enqueue again; nothing was captured.');
 return null;
}

/** Measure only the new files that lack a clock, the way the gate's Ring 1
 * timing step already does, then record them with the gate's own recorder.
 * @param {string} root */
async function recordLocalTimings(root){
 const timings=await import('./push-test-timings.mjs');
 const {PUSH_PROFILE}=await import('./push-budget.mjs');
 if(git(root,['status','--porcelain','--untracked-files=normal'])!=='')throw new Error('Commit or stash first: timing evidence needs a clean checkout');
 let upstream;
 try{git(root,['fetch','--quiet','--no-tags','origin','main'],20_000);}catch{ /* An older origin/main still names the added files. */ }
 try{upstream=git(root,['rev-parse','--verify','refs/remotes/origin/main^{commit}']);}catch{throw new Error('No origin/main to measure against');}
 const head=git(root,['rev-parse','HEAD']),base=git(root,['merge-base',upstream,head]);
 /** @type {{file:string,blob:string,rings:('full'|'1')[]}[]} */
 const missing=timings.missingTestTimings(`refs/heads/main ${head} refs/heads/main ${base}`,root);
 if(missing.length===0){console.log('push preflight timings: every new test file already has its committed clock');return;}
 const evidence=timings.prepareTestTimings(missing,PUSH_PROFILE,root);
 for(const ring of /** @type {const} */(['full','1'])){
  const request=evidence.requests[ring];if(request===undefined)continue;
  const files=missing.filter(row=>row.rings.includes(ring)).map(row=>row.file);
  /** @type {NodeJS.ProcessEnv} */const env={...process.env,WS_PUSH_TIMING_REQUEST:request};
  for(const key of ['WILDSHARD_RING','WS_TEST_QUARANTINE','WS_PUSH_TIMINGS'])Reflect.deleteProperty(env,key);
  if(ring==='1')env.WILDSHARD_RING='1';
  console.error(`push preflight timings: ${ring==='1'?'Ring 1':'full'} clock for ${files.join(', ')}`);
  const run=spawnSync(process.execPath,[join(import.meta.dirname,'vitest-tmp.ts'),'run','--passWithNoTests=false',...files,'--reporter=default',`--reporter=${join(import.meta.dirname,'push-timing-reporter.ts')}`],{cwd:root,env,stdio:'inherit'});
  if(run.status!==0)throw new Error(`The ${ring==='1'?'Ring 1':'full'} timing run failed; fix the tests first (evidence kept in ${evidence.directory})`);
  timings.completeTestTimings(request,0);
 }
 const recorded=timings.recordTestTimings(evidence.directory,root);
 console.log(`Recorded ${recorded.join(', ')}; commit test/durations.json test/durations-ring1.json test/durations-source.json with a project/journal/ line (30+ lines, D25) and enqueue normally.`);
}

/** Resolve a conflicted test/durations-source.json mid-rebase or merge by
 * keeping both sides: lists are unioned in order, objects merged by key, and a
 * disagreeing scalar refuses. VB18 retires this conflict for new observations.
 * @param {string} root */
function mergeDurations(root){
 /** @param {number} stage @returns {unknown} */
 const side=stage=>JSON.parse(git(root,['show',`:${stage}:${SOURCE}`]));
 /** @param {unknown} a @param {unknown} b @param {string} where @returns {unknown} */
 const merge=(a,b,where)=>{
  if(Array.isArray(a)&&Array.isArray(b)){const seen=new Set(a.map(row=>JSON.stringify(row)));return [...a,...b.filter(row=>!seen.has(JSON.stringify(row)))];}
  if(a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
   /** @type {Record<string,unknown>} */const out={...a};
   for(const [key,value] of Object.entries(b))out[key]=key in a?merge(/** @type {Record<string,unknown>} */(a)[key],value,`${where}.${key}`):value;
   return out;
  }
  if(JSON.stringify(a)===JSON.stringify(b))return a;
  throw new Error(`Both sides changed ${where} differently; resolve it by hand`);
 };
 const merged=merge(side(2),side(3),'$');
 writeFileSync(join(root,SOURCE),`${JSON.stringify(merged,null,2)}\n`);
 console.log(`Merged both sides of ${SOURCE}; now: git add ${SOURCE} && git rebase --continue`);
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [command='check',...rest]=process.argv.slice(2);
 const root=resolve(rest.find(arg=>!arg.startsWith('--'))??'.');
 try{
  if(command==='check'){
   const report=await preflight(root,{sha:rest.find(arg=>arg.startsWith('--commit='))?.slice(9),fetch:!rest.includes('--no-fetch')});
   console.log(rest.includes('--json')?JSON.stringify(report):formatReport(report));
   process.exitCode=report.refusals.length>0?1:0;
  }else if(command==='timings')await recordLocalTimings(root);
  else if(command==='merge-durations')mergeDurations(root);
  else throw new Error('Usage: push-preflight.mjs check [repo] [--commit=sha] [--json] [--no-fetch] | timings [repo] | merge-durations [repo]');
 }catch(error){console.error(`push preflight: ${reason(error)}`);process.exitCode=2;}
}
