// An actual zero-exit local hook, never its logged test output, permits carry.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
/** @param {string} root @param {string} token */
function ackPath(root,token){
 if(!UUID.test(token))throw new Error('Invalid local hook acknowledgment');
 return resolve(root,execFileSync('git',['rev-parse','--git-path',`wildshard-land-ack/${token}.json`],{cwd:root,encoding:'utf8'}).trim());
}
/** @param {string} file @param {string} head @param {'pending'|'green'} state */
function matches(file,head,state){
 try{
  const info=lstatSync(file);
  if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o022)!==0)return false;
  /** @type {{head?:unknown,state?:unknown}} */const data=JSON.parse(readFileSync(file,'utf8'));
  return data.head===head&&data.state===state;
 }catch{return false;}
}
/** @param {string} root @param {string} head */
export function beginLocalHook(root,head){
 const token=randomUUID(),file=ackPath(root,token);
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 writeFileSync(file,JSON.stringify({head,state:'pending'}),{mode:0o600,flag:'wx'});
 return {token,finish:()=>{
  const green=matches(file,head,'green');
  if(existsSync(file))unlinkSync(file);
  return green;
 }};
}
/** Called only by the real local hook after its child gate exited zero.
 * The nonce is deliberately omitted from the gate/test worker environment.
 * @param {string} root @param {string} head @param {string|undefined} token */
export function completeLocalHook(root,head,token){
 if(token===undefined)return; // Non-land callers have no handshake.
 const file=ackPath(root,token);
 if(!matches(file,head,'pending'))throw new Error('Local hook acknowledgment is unavailable');
 const next=`${file}.${process.pid}`;
 writeFileSync(next,JSON.stringify({head,state:'green'}),{mode:0o600,flag:'wx'});renameSync(next,file);
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const head=/^local:([a-f0-9]{40})$/u.exec(process.env.WS_LAND_MAIN_PUSH??'')?.[1];
 if(head!==undefined)completeLocalHook(process.cwd(),head,process.env.WS_LAND_HOOK_ACK);
}
