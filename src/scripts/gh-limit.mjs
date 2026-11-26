// Meta MINI-FLOW MF12: tell a GitHub quota stop from "no CI run". On 2026-11-16 the API quota hit 0 of 5000 while
// land waited on a branch run; every lookup failed, land read that as "no hosted ci run after 5 min" and stopped a green
// plan. A rate-limited reply now means: ask when the quota resets, sleep until then, and resume with the deadlines moved
// by the wait. `gh api rate_limit` does not spend quota, so asking it is free.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

/** A reply GitHub gives when the quota (primary or secondary) is spent. A plain 403 (no access) is not one. */
export const RATE_LIMITED=/API rate limit exceeded|secondary rate limit|rate limit exceeded|HTTP 429|abuse detection/iu;

/** Thrown by a gh call whose reply was a quota stop. `resetAt` is when the quota comes back (epoch ms). */
export class GitHubLimitError extends Error{
 name='GitHubLimitError';
 /** @param {string} message @param {number} resetAt */
 constructor(message,resetAt){super(message);this.resetAt=resetAt;}
}

/** When the spent quota comes back, from `gh api rate_limit` (epoch ms): the latest reset among the core and search
 * resources that are at 0. A secondary limit (quota left, still refused) or an unreadable answer waits one minute.
 * @param {(args:string[])=>{status:number|null,stdout:string}} [gh] @param {number} [now] */
export function quotaReset(gh=args=>spawnSync('gh',args,{encoding:'utf8',timeout:30_000}),now=Date.now()){
 const fallback=now+60_000;
 try{
  const reply=gh(['api','rate_limit']);
  if(reply.status!==0)return fallback;
  const resources=/** @type {Record<string,{remaining?:number,reset?:number}>} */(JSON.parse(reply.stdout).resources??{});
  const spent=Object.values(resources).filter(row=>row.remaining===0&&typeof row.reset==='number').map(row=>Number(row.reset)*1000);
  return spent.length===0?fallback:Math.max(...spent);
 }catch{return fallback;}
}

/** Turn a failed gh reply into the right error: a GitHubLimitError when the quota is spent, else a plain Error.
 * @param {string} what @param {string} detail stderr and any spawn error @param {() => number} [reset] */
export function ghFailure(what,detail,reset=()=>quotaReset()){
 const text=`${what} failed: ${detail.trim().slice(0,300)}`;
 return RATE_LIMITED.test(detail)?new GitHubLimitError(text,reset()):new Error(text);
}

/** How long to back off for a GitHub failure: until the quota resets (plus a second) for a limit, else one poll.
 * @param {unknown} error @param {number} pollMs @param {number} [now] */
export function backoffMs(error,pollMs,now=Date.now()){
 if(!(error instanceof GitHubLimitError))return pollMs;
 return Math.max(pollMs,error.resetAt-now+1000);
}

// MF12 (4): the reader App. Every lane on both machines asks GitHub as Jake's user, so they share one 5,000-an-hour
// quota. A GitHub App installation token has its own. When the App's key is on this machine, land's and main-watch's CI
// reads use a read-only installation token; pushes, re-runs and dispatches stay on the user's gh login. Meta's
// scripts/gh-reader-token.mjs mints and caches it (a JWT needs base64, which this repo's lint refuses, G649); this side
// only reads the cache and asks meta when it is stale. Without the key nothing changes.

/** Where the reader App's key, client ID and token cache live, and meta's minter. @param {NodeJS.ProcessEnv} env */
export function readerPaths(env=process.env){
 const config=env.WS_GH_READER_DIR??join(homedir(),'.config/wildshard');
 const common=spawnSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:import.meta.dirname,encoding:'utf8'}).stdout?.trim()??'';
 const meta=env.WS_META_DIR??resolve(dirname(common||join(import.meta.dirname,'..', '..','.git')),'..','..','project-wildshard-meta');
 // The mini's key went in as github-reader.client-id (meta MINI-AUTONOMY MA6); MF12's first name still works.
 const client=['github-reader.client-id','github-reader-client-id'].map(name=>join(config,name)).find(existsSync)??join(config,'github-reader.client-id');
 return {key:join(config,'github-reader.pem'),client,
  cache:env.WS_GH_READER_CACHE??join(homedir(),'.cache/wildshard/github-reader-token.json'),minter:join(meta,'scripts/gh-reader-token.mjs')};
}

/** After a failed mint, this process reads as the gh user for ten minutes instead of asking on every call. */
let mintFailedUntil=0;

/** The reader App's token, or undefined (the caller then reads as the gh user, as before).
 * @param {{env?:NodeJS.ProcessEnv,now?:number,mint?:(minter:string,env:NodeJS.ProcessEnv)=>{status:number|null,stdout:string,stderr:string}}} [options]
 * @returns {string|undefined} */
export function readerToken({env=process.env,now=Date.now(),mint=(minter,childEnv)=>spawnSync(process.execPath,[minter],{encoding:'utf8',env:childEnv,timeout:60_000})}={}){
 if(env.WS_GH_READER==='0'||now<mintFailedUntil)return undefined;
 const paths=readerPaths(env);
 if(!existsSync(paths.key)||!existsSync(paths.client))return undefined;
 try{
  const cached=/** @type {{token?:string,expiresAt?:number}} */(JSON.parse(readFileSync(paths.cache,'utf8')));
  if(typeof cached.token==='string'&&typeof cached.expiresAt==='number'&&cached.expiresAt-now>5*60_000)return cached.token;
 }catch{/* No cache yet: ask meta to mint one. */}
 const minted=existsSync(paths.minter)?mint(paths.minter,env):{status:null,stdout:'',stderr:`no ${paths.minter}`};
 const token=(minted.stdout??'').trim();
 if(minted.status===0&&token!=='')return token;
 mintFailedUntil=now+10*60_000;
 process.stderr.write(`gh-limit: no reader App token (${((minted.stderr??'')||`exit ${String(minted.status)}`).trim().split('\n')[0]}); reading as the gh user for 10 min\n`);
 return undefined;
}

/** The environment for a read-only gh call: GH_TOKEN set to the reader App's token when there is one.
 * @param {NodeJS.ProcessEnv} [env] @returns {NodeJS.ProcessEnv} */
export function readerEnv(env=process.env){
 const token=readerToken({env});
 return token===undefined?env:{...env,GH_TOKEN:token};
}
