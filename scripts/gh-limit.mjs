// Meta MINI-FLOW MF12: tell a GitHub quota stop from "no CI run". On 2026-11-16 the API quota hit 0 of 5000 while
// land waited on a branch run; every lookup failed, land read that as "no hosted ci run after 5 min" and stopped a green
// plan. A rate-limited reply now means: ask when the quota resets, sleep until then, and resume with the deadlines moved
// by the wait. `gh api rate_limit` does not spend quota, so asking it is free.
import {spawnSync} from 'node:child_process';
import {sign} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';

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
// quota. A GitHub App installation token has its own quota. When the App's client ID and private key are on this machine,
// land's and main-watch's CI reads go through a read-only installation token (Actions, Checks and Contents read, cached
// until five minutes before it expires); pushes, re-runs and dispatches stay on the user's gh login. Without the files
// nothing changes.

/** Where the reader App's files live. @param {NodeJS.ProcessEnv} env */
export function readerPaths(env=process.env){
 const config=env.WS_GH_READER_DIR??join(homedir(),'.config/wildshard');
 return {key:join(config,'github-reader.pem'),client:join(config,'github-reader-client-id'),
  cache:env.WS_GH_READER_CACHE??join(homedir(),'.cache/wildshard/github-reader-token.json')};
}

const b64=(/** @type {string|Buffer} */value)=>Buffer.from(value).toString('base64url');

/** A JWT the App signs for itself (RS256, nine minutes, backdated a minute for clock skew).
 * @param {string} client @param {string} pem @param {number} now epoch ms */
export function appJwt(client,pem,now){
 const iat=Math.floor(now/1000)-60,body=`${b64(JSON.stringify({alg:'RS256',typ:'JWT'}))}.${b64(JSON.stringify({iat,exp:iat+600,iss:client}))}`;
 return `${body}.${b64(sign('RSA-SHA256',Buffer.from(body),pem))}`;
}

/** One HTTPS call through curl (synchronous, like the gh calls it stands beside). Throws on a non-2xx.
 * @param {string} method @param {string} url @param {string} jwt @param {string} [body] */
function appCall(method,url,jwt,body){
 const result=spawnSync('curl',['-sS','--max-time','20','-X',method,'-H',`Authorization: Bearer ${jwt}`,'-H','Accept: application/vnd.github+json',
  '-H','X-GitHub-Api-Version: 2022-11-28',...(body===undefined?[]:['--data-binary','@-']),'-w','\n%{http_code}',url],{encoding:'utf8',input:body,timeout:30_000});
 const lines=(result.stdout??'').trimEnd().split('\n'),code=Number(lines.pop());
 if(result.status!==0||!(code>=200&&code<300))throw new Error(`${method} ${url} answered ${String(code)} ${lines.join(' ').slice(0,200)}${result.stderr??''}`.trim());
 return /** @type {Record<string,unknown>} */(JSON.parse(lines.join('\n')));
}

/** After a failed mint, this process reads as the gh user for ten minutes instead of failing on every call. */
let mintFailedUntil=0;

/** The reader App's installation token for the org, or undefined when the App's files are not on this machine or
 * minting fails (the caller then uses the user's gh login, as before).
 * @param {{env?:NodeJS.ProcessEnv,now?:number,org?:string,call?:typeof appCall}} [options] @returns {string|undefined} */
export function readerToken({env=process.env,now=Date.now(),org='project-wildshard',call=appCall}={}){
 const paths=readerPaths(env);
 if(env.WS_GH_READER==='0'||now<mintFailedUntil||!existsSync(paths.key)||!existsSync(paths.client))return undefined;
 try{
  const cached=/** @type {{token?:string,expiresAt?:number}} */(JSON.parse(readFileSync(paths.cache,'utf8')));
  if(typeof cached.token==='string'&&typeof cached.expiresAt==='number'&&cached.expiresAt-now>5*60_000)return cached.token;
 }catch{/* No cache yet: mint one. */}
 try{
  const jwt=appJwt(readFileSync(paths.client,'utf8').trim(),readFileSync(paths.key,'utf8'),now);
  const installation=call('GET',`https://api.github.com/orgs/${org}/installation`,jwt);
  const minted=call('POST',`https://api.github.com/app/installations/${String(installation.id)}/access_tokens`,jwt,JSON.stringify({permissions:{actions:'read',checks:'read',contents:'read'}}));
  const token=String(minted.token),expiresAt=Date.parse(String(minted.expires_at));
  mkdirSync(dirname(paths.cache),{recursive:true});
  writeFileSync(paths.cache,JSON.stringify({token,expiresAt}),{mode:0o600});
  return token;
 }catch(error){
  mintFailedUntil=now+10*60_000;
  process.stderr.write(`gh-limit: the reader App token could not be minted (${error instanceof Error?error.message.split('\n')[0]:String(error)}); reading as the gh user for 10 min\n`);
  return undefined;
 }
}

/** The environment for a read-only gh call: GH_TOKEN set to the reader App's token when there is one.
 * @param {NodeJS.ProcessEnv} [env] @returns {NodeJS.ProcessEnv} */
export function readerEnv(env=process.env){
 const token=readerToken({env});
 return token===undefined?env:{...env,GH_TOKEN:token};
}
