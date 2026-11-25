// Which lane made each outgoing commit (meta QA 11-25 row 58). A lane pushes only its own commits: in a shared checkout
// such as engine-quickfix, another lane's local commits stay put (main-push.mjs pushes around them; land.mjs refuses).
// A commit's lane is its `Lane:` trailer: main-push writes one on every commit it makes (M11), and the commit-msg hook
// adds one from WS_LANE_NAME to a commit made by hand (.githooks/lane-trailer.mjs).
import {spawnSync} from 'node:child_process';

/** @typedef {{sha:string,subject:string,lane:string|null}} LaneCommit */

/** The lane a commit message names: its last `Lane: <lane>` line. Read from the whole body, not git's trailer block:
 * main-push writes `Lane:` in its own paragraph above `Assisted-by:`, which `%(trailers)` never sees.
 * @param {string} message @returns {string|null} */
export function messageLane(message){
 return messageLanes(message).at(-1)??null;
}

/** Every lane a commit message names in `Lane: <lane>` lines, in order. @param {string} message @returns {string[]} */
export function messageLanes(message){
 return [...message.matchAll(/^Lane: ([a-z][a-z0-9_-]*)\s*$/gmu)].map(match=>match[1]??'').filter(Boolean);
}

/** The commits of `range`, oldest first, each with the lane its message names, or null for none.
 * @param {string} cwd @param {string} range @param {NodeJS.ProcessEnv} [env] @returns {LaneCommit[]} */
export function commitLanes(cwd,range,env=process.env){
 const out=spawnSync('git',['log','--reverse','--format=%H%x00%s%x00%B%x1e',range],{cwd,env,encoding:'utf8',maxBuffer:64<<20});
 if(out.status!==0)throw new Error(`git log ${range}: ${out.stderr.trim()}`);
 return out.stdout.split('\u001E').map(entry=>entry.replace(/^\n+/u,'')).filter(entry=>entry.trim()!=='').map(entry=>{
  const [sha='',subject='',body='']=entry.split('\0');
  return {sha,subject,lane:messageLane(body)};
 });
}

/** Commits another lane made: a different `Lane:` trailer, or (when `unnamed` is 'foreign') none at all.
 * @param {readonly LaneCommit[]} commits @param {string} lane @param {{unnamed?:'own'|'foreign'}} [options] */
export function foreignCommits(commits,lane,{unnamed='foreign'}={}){
 return commits.filter(row=>row.lane===null?unnamed==='foreign':row.lane!==lane);
}

/** `<short sha> (<lane>) <subject>` for each, for a receipt or a refusal. @param {readonly LaneCommit[]} commits */
export function nameCommits(commits){
 return commits.map(row=>`${row.sha.slice(0,10)} (${row.lane??'no Lane trailer'}) ${row.subject}`).join('; ');
}
