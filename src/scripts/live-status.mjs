// Meta MINI-AUTONOMY MA3: what staging, production and preview serve right now, and whether a main SHA is inside each,
// so a lane on the Mac mini learns its commit is live without asking the MacBook.
//   node src/scripts/live-status.mjs [<sha>] [--json]
// Public GETs only: each channel's signed release file (server serial and build), the page's /version.json (page
// build and client version), the staging box's /health on the tailnet (the build and serial it runs; "unreachable"
// off the tailnet), api.wildshard.io/api/health, and npm's latest @wildshard/engine, sdk and shard-format. With a SHA
// it answers yes/no per channel for the page and the server: local git first (`merge-base --is-ancestor`), else
// GitHub's public compare API (on the reader App token when this machine has one, src/scripts/gh-limit.mjs).
// Exit 0 when every source answered; 1 when one could not be read (its line says which); 2 on bad arguments.
// oxlint-disable-next-line import/no-unassigned-import -- Install the network marker for this probe.
import './agent-fetch.mjs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readerToken} from './gh-limit.mjs';

export const SOURCES={
 staging:{release:'https://releases.wildshard.io/staging.json',page:'https://staging.wildshard.io/version.json',
  box:'https://wildshard.tailb41b20.ts.net:8443/health'},
 production:{release:'https://releases.wildshard.io/production.json',page:'https://play.wildshard.io/version.json'},
 preview:{page:'https://preview.wildshard.io/version.json'},
 api:'https://api.wildshard.io/api/health',
 npm:['@wildshard/engine','@wildshard/sdk','@wildshard/shard-format'],
};
const REPO='project-wildshard/engine';
const TIMEOUT_MS=15_000;

/** @typedef {{build:string,version?:string,serial?:number}} Served */
/** @typedef {{channel:string,page?:Served,server?:Served,box?:Served,errors:string[]}} Channel */
/** @typedef {{channels:Channel[],api?:{version:string,shardFormat?:string},npm:{name:string,version:string,gitHead?:string}[],errors:string[]}} Live */
/** @typedef {(url:string)=>Promise<unknown>} GetJson */

/** @param {unknown} value @returns {Record<string,unknown>} */
const record=value=>(typeof value==='object'&&value!==null?/** @type {Record<string,unknown>} */(value):{});
/** A string or number as text; anything else as ''. @param {unknown} value */
const text=value=>(typeof value==='string'?value:typeof value==='number'?String(value):'');
/** @param {unknown} error */
const reason=error=>(error instanceof Error?error.message:String(error)).split('\n')[0]??'';

/** A GET that resolves to parsed JSON, or rejects with the status. @type {GetJson} */
export async function getJson(url){
 const reply=await fetch(url,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(TIMEOUT_MS)});
 if(!reply.ok)throw new Error(`${url} answered ${String(reply.status)}`);
 return reply.json();
}

/** The server a signed release file names: its serial, engine build and, for a tagged bundle (`v0.1.31/...`), version.
 * @param {unknown} file @returns {Served} */
export function releaseServed(file){
 const body=record(JSON.parse(String(record(file).body)));
 const bundle=text(record(body.bundle).name);
 const tag=/^v\d+\.\d+\.\d+(?=\/)/u.exec(bundle)?.[0];
 return {build:text(body.engineBuild),serial:Number(body.serial),...(tag===undefined?{}:{version:tag})};
}

/** @param {unknown} file @returns {Served} */
const pageServed=file=>{const page=record(file);return {build:text(page.build),version:`v${text(page.clientVersion)}`};};
/** @param {unknown} file @returns {Served} */
const boxServed=file=>{const health=record(file);return {build:text(health.build),serial:Number(health.serial)};};

/** Read every source. A source that fails leaves its field out and adds a line to `errors`.
 * @param {GetJson} [get] @returns {Promise<Live>} */
export async function readLive(get=getJson){
 /** @type {<T>(url:string,shape:(value:unknown)=>T,errors:string[])=>Promise<T|undefined>} */
 const read=async(url,shape,errors)=>{try{return shape(await get(url));}catch(error){errors.push(reason(error));return undefined;}};
 /** @param {string} name @param {{release?:string,page?:string,box?:string}} urls @returns {Promise<Channel>} */
 const channel=async(name,urls)=>{
  /** @type {string[]} */ const errors=[];
  const [page,server,box]=await Promise.all([
   urls.page===undefined?undefined:read(urls.page,pageServed,errors),
   urls.release===undefined?undefined:read(urls.release,releaseServed,errors),
   urls.box===undefined?undefined:read(urls.box,boxServed,[]),
  ]);
  return {channel:name,...(page===undefined?{}:{page}),...(server===undefined?{}:{server}),...(box===undefined?{}:{box}),errors};
 };
 /** @type {string[]} */ const errors=[];
 const [staging,production,preview,api,...npm]=await Promise.all([
  channel('staging',SOURCES.staging),channel('production',SOURCES.production),channel('preview',SOURCES.preview),
  read(SOURCES.api,value=>{const health=record(value);return {version:text(health.version),...(health.shardFormat===undefined?{}:{shardFormat:text(health.shardFormat)})};},errors),
  ...SOURCES.npm.map(name=>read(`https://registry.npmjs.org/${name.replace('/','%2f')}`,value=>{
   const latest=text(record(record(value)['dist-tags']).latest);
   const gitHead=record(record(record(value).versions)[latest]).gitHead;
   return {name,version:latest,...(typeof gitHead==='string'?{gitHead}:{})};
  },errors)),
 ]);
 return {channels:[staging,production,preview],...(api===undefined?{}:{api}),
  npm:npm.filter(row=>row!==undefined),errors:[...errors,...[staging,production,preview].flatMap(row=>row.errors)]};
}

/** Does `build` contain `sha`? true/false, or undefined when neither local git nor GitHub can say.
 * @typedef {(sha:string,build:string)=>Promise<boolean|undefined>} Contains */

/** Local git: exit 0 yes, 1 no; anything else (a missing object) is unknown. @param {string} sha @param {string} build */
export function gitContains(sha,build){
 const result=spawnSync('git',['merge-base','--is-ancestor',sha,build],{cwd:import.meta.dirname,encoding:'utf8'});
 return result.status===0?true:result.status===1?false:undefined;
}

/** GitHub's compare API: `sha...build` is "ahead" or "identical" when build contains sha. @param {string} sha @param {string} build */
export async function githubContains(sha,build){
 const token=readerToken();
 const reply=await fetch(`https://api.github.com/repos/${REPO}/compare/${sha}...${build}`,{signal:AbortSignal.timeout(TIMEOUT_MS),
  headers:{accept:'application/vnd.github+json',...(token===undefined?{}:{authorization:`Bearer ${token}`})}});
 if(!reply.ok)return undefined;
 const status=text(record(await reply.json()).status);
 return status==='ahead'||status==='identical'?true:status==='behind'||status==='diverged'?false:undefined;
}

/** @type {Contains} */
export const contains=(sha,build)=>{
 const local=gitContains(sha,build);
 return local===undefined?githubContains(sha,build).catch(()=>undefined):Promise.resolve(local);
};

/** @param {Served|undefined} served @param {string} [source] */
const show=(served,source)=>served===undefined?'unread':
 `${served.version===undefined?'':`${served.version} `}${served.build.slice(0,8)}${served.serial===undefined?'':` serial ${String(served.serial)}`}${source===undefined?'':` (${source})`}`;
/** @param {boolean|undefined} answer */
const yesNo=answer=>(answer===undefined?'unknown':answer?'yes':'no');

/** The report: one line per channel, the API, npm, then the SHA's answers.
 * @param {Live} live @param {{sha:string,answers:Record<string,{page?:boolean,server?:boolean,box?:boolean}>}} [question] */
export function render(live,question){
 const lines=live.channels.map(row=>[
  `${row.channel.padEnd(10)} page ${show(row.page)}`,
  ...(row.channel==='preview'?[]:[`server ${show(row.server,'release')}`]),
  ...(row.box===undefined?row.channel==='staging'?['box unreachable (tailnet)']:[]:[`box ${show(row.box)}${row.server!==undefined&&row.box.serial!==row.server.serial?' (behind the release)':''}`]),
 ].join('  '));
 lines.push(`${'api'.padEnd(10)} ${live.api===undefined?'unread':`${live.api.version}${live.api.shardFormat===undefined?'':` shard-format ${live.api.shardFormat}`}`}`);
 lines.push(`${'npm'.padEnd(10)} ${live.npm.map(row=>`${row.name} ${row.version}${row.gitHead===undefined?'':` (${row.gitHead.slice(0,8)})`}`).join(', ')}`);
 if(question!==undefined)for(const row of live.channels){
  const got=question.answers[row.channel]??{};
  lines.push(`${question.sha.slice(0,8)} in ${row.channel}: page ${yesNo(got.page)}${row.channel==='preview'?'':`, server ${yesNo(got.server)}`}${got.box===undefined?'':`, box ${yesNo(got.box)}`}`);
 }
 for(const error of live.errors)lines.push(`unread: ${error}`);
 return lines.join('\n');
}

/** Answer whether `sha` is inside each channel's page, server and running box. @param {Live} live @param {string} sha @param {Contains} [inside] */
export async function whereIs(live,sha,inside=contains){
 /** @type {Record<string,{page?:boolean,server?:boolean,box?:boolean}>} */ const answers={};
 /** @param {Served|undefined} served */
 const ask=served=>(served===undefined?Promise.resolve(undefined):inside(sha,served.build));
 for(const row of live.channels){
  const [page,server,box]=await Promise.all([ask(row.page),ask(row.server),ask(row.box)]);
  answers[row.channel]={...(page===undefined?{}:{page}),...(server===undefined?{}:{server}),...(box===undefined?{}:{box})};
 }
 return answers;
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const args=process.argv.slice(2),json=args.includes('--json'),rest=args.filter(arg=>arg!=='--json');
 if(rest.length>1||rest.some(arg=>!/^[0-9a-f]{7,40}$/u.test(arg))){
  process.stderr.write('usage: node src/scripts/live-status.mjs [<sha>] [--json]\n');
  process.exitCode=2;
 }else{
  const live=await readLive();
  const given=rest[0];
  const full=given===undefined?undefined:spawnSync('git',['rev-parse','--verify','--quiet',`${given}^{commit}`],{cwd:import.meta.dirname,encoding:'utf8'}).stdout.trim()||given;
  const question=full===undefined?undefined:{sha:full,answers:await whereIs(live,full)};
  process.stdout.write(`${json?JSON.stringify({...live,...(question===undefined?{}:{question})},null,1):render(live,question)}\n`);
  process.exitCode=live.errors.length===0?0:1;
 }
}
