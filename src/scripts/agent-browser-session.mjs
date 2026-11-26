// Admission spans a complete task, its CLI daemon and physical browser drain.
// KEYCHAIN_ARGS supplies --use-mock-keychain, --password-store=basic and --mute-audio; withProdBlock makes the
// production rooms host unresolvable, so agent-browser over CDP stops at prod's title too (J205, QA 11-25 row 124).
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from './browser-playwright.mjs';
import {KEYCHAIN_ARGS} from './.kit/chromium-keychain.mjs';
import {withProdBlock} from './browser-prod-guard.mjs';
import {runT1Child} from './t1-runner.mjs';
import {nativeSocketTemporary} from '../../test/fixtures/native-socket-temp.mjs';

/** Close only the daemons recorded by this private, unique task socket directory.
 * Birth/UID checks prevent a reused PID from receiving an escalation signal.
 * @param {NodeJS.ProcessEnv} env @param {string} socketRoot
 * @param {{close?:()=>{status:number|null,stderr:string},graceMs?:number,termMs?:number,killMs?:number}} [options] */
export async function drainAgentDaemon(env,socketRoot,{close,graceMs=8000,termMs=2000,killMs=5000}={}){
 const identity=(/** @type {number} */pid)=>{
  const result=spawnSync('ps',['-p',String(pid),'-o','uid=','-o','lstart='],{encoding:'utf8',timeout:5000});
  if(result.status===1&&result.stdout.trim()==='')return null;
  if(result.error!==undefined||result.status!==0)throw new Error('Owned daemon identity is unavailable');
  const birth=result.stdout.trim();
  if(Number(birth.split(/\s+/u)[0])!==process.getuid?.())throw new Error('Owned daemon UID changed');
  return birth;
 };
 const records=readdirSync(socketRoot,{recursive:true,encoding:'utf8'}).filter(name=>name.endsWith('.pid')).map(name=>{
  const pid=Number(readFileSync(resolve(socketRoot,name),'utf8'));
  if(!Number.isSafeInteger(pid)||pid<=1)throw new Error('Invalid owned daemon PID');
  return{pid,birth:identity(pid)};
 }).filter(record=>record.birth!==null);
 const closingEnv={...env};delete closingEnv.AGENT_BROWSER_CDP;
 const closed=close?.()??spawnSync('agent-browser',['close'],{env:closingEnv,encoding:'utf8',timeout:30000});
 if(closed.status!==0)console.error('Owned agent-browser daemon close refused:',closed.stderr);
 const alive=(/** @type {{pid:number,birth:string|null}} */record)=>{
  if(record.birth===null)return false;
  try{process.kill(record.pid,0);return true;}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ESRCH')return false;throw error;}
 };
 const wait=async(/** @type {number} */ms)=>{
  const deadline=Date.now()+ms;
  while(records.some(alive)&&Date.now()<deadline)await delay(20);
 };
 const signal=(/** @type {NodeJS.Signals} */kind)=>{
  for(const record of records){
   if(!alive(record))continue;
   if(identity(record.pid)!==record.birth){record.birth=null;continue;}
   try{process.kill(record.pid,kind);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw error;}
  }
 };
 await wait(graceMs);
 if(records.some(alive)){signal('SIGTERM');await wait(termMs);}
 if(records.some(alive)){signal('SIGKILL');await wait(killMs);}
 // A replaced PID belongs to another task and must never retain this charge.
 for(const record of records)if(alive(record)&&identity(record.pid)!==record.birth)record.birth=null;
 if(records.some(alive))throw new Error(`Owned agent-browser daemons did not drain: ${records.filter(alive).map(record=>record.pid).join(',')}`);
}

/** @param {string[]} command @returns {Promise<number>} */
export async function runAgentBrowserTask(command){
 if(command.length===0)throw new Error('usage: node src/scripts/agent-browser-session.mjs -- <task command...>');
 const root=resolve('tmp',process.env.WS_LANE_NAME??'browser-task');mkdirSync(root,{recursive:true});
 const scratch=mkdtempSync(join(root,'agent-browser-')),temporary=await nativeSocketTemporary(scratch);
 const previous=process.env.TMPDIR;
 let browser,daemonDrained=true;
 try{
  process.env.TMPDIR=temporary.path;
  try{browser=await chromium.launchServer({headless:true,args:withProdBlock([...KEYCHAIN_ARGS,'--remote-debugging-port=0']),downloadsPath:join(scratch,'downloads')});}
  finally{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous;}
  const native=browser.process();
  const profile=native.spawnargs.find(arg=>arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  if(profile===undefined)throw new Error('Owned Chrome profile is unavailable');
  const [port]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n');
  if(!/^\d+$/u.test(port??''))throw new Error('Owned Chrome CDP endpoint is unavailable');
  const session=`b${randomUUID().slice(0,8)}`;
  /** @type {NodeJS.ProcessEnv} */
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AGENT_BROWSER_'))),
   AGENT_BROWSER_CDP:`http://127.0.0.1:${port}`,AGENT_BROWSER_SESSION:session,
   AGENT_BROWSER_NAMESPACE:session,AGENT_BROWSER_SOCKET_DIR:temporary.path,TMPDIR:temporary.path};
  daemonDrained=false;
  try{
   const result=await runT1Child(command,env,{timeoutMs:3600000});
   return result.error!==null||result.signal!==null?1:result.status??1;
  }finally{
   await drainAgentDaemon(env,temporary.path);daemonDrained=true;
  }
 }catch(error){
  if(daemonDrained)throw error;
  console.error('Retaining owned browser, admission and task directory after daemon drain failure:',scratch,error);
  return 1;
 }finally{
  // Live browser/provider handles retain the owner and charge on refusal.
  if(daemonDrained){await browser?.close();await temporary.dispose();rmSync(scratch,{recursive:true,force:true});}
 }
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const command=process.argv.slice(2);if(command[0]==='--')command.shift();
 process.exitCode=await runAgentBrowserTask(command);
}
