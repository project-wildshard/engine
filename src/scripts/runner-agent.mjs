// Meta QA 11-26 row 11: the agent that runs main-watch, as `<vendor>:<model>` for meta's QA writer (`--agent`).
// Jake, 11-26: "make the agent a mandatory parameter to the script so it doesnt lie" and "dont hardcode opus".
// main-watch is started by land, main-push and the pre-push from inside an agent's shell (MacBook and Mac mini alike;
// neither machine has a launchd or cron tick for it), so it inherits that agent's environment. WS_AGENT wins when
// set. Otherwise the model is read from the runner's own session log, never a default:
//   Claude Code sets CLAUDE_CODE_SESSION_ID; its log is ~/.claude/projects/<cwd>/<id>.jsonl, and each assistant line
//   names the model that wrote it (an Agent-tool subagent shares its parent session, so it names the parent's model).
//   Codex sets CODEX_THREAD_ID; its log is ~/.codex/sessions/<y>/<m>/<d>/rollout-<time>-<id>.jsonl, and each
//   turn_context line names the turn's model.
// No session or no model found means undefined: main-watch then writes no QA row, only a receipt saying so.
import {closeSync,existsSync,fstatSync,openSync,readSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const TAIL=4<<20;
const CLAUDE_MODEL=/^claude-[\w.-]+$/u;
const CODEX_MODEL=/^[\w.-]+$/u;
const SESSION=/^[\w-]+$/u;

/** The last `limit` bytes of a file, cut to whole lines.
 * @param {string} path @param {number} [limit] @returns {string[]} */
function tailLines(path,limit=TAIL){
  const fd=openSync(path,'r');
  try{
    const size=fstatSync(fd).size,start=Math.max(0,size-limit),buffer=Buffer.alloc(size-start);
    readSync(fd,buffer,0,buffer.length,start);
    const lines=buffer.toString('utf8').split('\n');
    return start>0?lines.slice(1):lines;
  }finally{closeSync(fd);}
}

/** The newest model a session log names, or undefined.
 * @param {string} path @param {(row:any)=>unknown} pick @param {RegExp} shape @returns {string|undefined} */
function newestModel(path,pick,shape){
  const lines=tailLines(path);
  for(let index=lines.length-1;index>=0;index--){
    const line=lines[index];
    if(!line.includes('"model"'))continue;
    let model;
    try{model=pick(JSON.parse(line));}catch{continue;}
    if(typeof model==='string'&&shape.test(model))return model;
  }
  return undefined;
}

/** @param {string} root @param {string} id @returns {string|undefined} */
function claudeLog(root,id){
  if(!existsSync(root))return undefined;
  for(const project of readdirSync(root)){
    const path=join(root,project,`${id}.jsonl`);
    if(existsSync(path))return path;
  }
  return undefined;
}

/** Newest day first: a live session's log is under the day it started.
 * @param {string} root @param {string} id @returns {string|undefined} */
function codexLog(root,id){
  /** @param {string} dir */
  const down=dir=>existsSync(dir)?readdirSync(dir).filter(name=>/^\d+$/u.test(name)).sort().reverse():[];
  for(const year of down(root))for(const month of down(join(root,year)))for(const day of down(join(root,year,month))){
    const dir=join(root,year,month,day),name=readdirSync(dir).find(file=>file.startsWith('rollout-')&&file.endsWith(`-${id}.jsonl`));
    if(name!==undefined)return join(dir,name);
  }
  return undefined;
}

/** The runner's `<vendor>:<model>`, or undefined when nothing names it.
 * @param {NodeJS.ProcessEnv} [env] @param {string} [home] its HOME by default @returns {string|undefined} */
export function runnerAgent(env=process.env,home=env.HOME??homedir()){
  const named=env.WS_AGENT?.trim()??'';
  if(named!=='')return named;
  try{
    const codex=env.CODEX_THREAD_ID??'';
    if(SESSION.test(codex)){
      const log=codexLog(join(env.CODEX_HOME??join(home,'.codex'),'sessions'),codex);
      const model=log===undefined?undefined:newestModel(log,row=>row?.type==='turn_context'?row.payload?.model:undefined,CODEX_MODEL);
      if(model!==undefined)return `codex:${model}`;
    }
    const claude=env.CLAUDE_CODE_SESSION_ID??'';
    if(SESSION.test(claude)){
      const log=claudeLog(join(env.CLAUDE_CONFIG_DIR??join(home,'.claude'),'projects'),claude);
      const model=log===undefined?undefined:newestModel(log,row=>row?.type==='assistant'?row.message?.model:undefined,CLAUDE_MODEL);
      if(model!==undefined)return `claude:${model}`;
    }
  }catch{/* An unreadable session log names nobody. */}
  return undefined;
}
