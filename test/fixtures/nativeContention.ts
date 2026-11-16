// oxlint-disable-next-line import/no-nodejs-modules -- Bound the real proof and its complete owned process group.
import {spawn} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep all actors and evidence in this run's scratch.
import {resolve} from 'node:path';

/** Each hosted file runs one original suite, inside its native no-sibling unit.
 * The proof handles TERM and drains; a hard fallback covers a stuck actor. */
export async function nativeContention(file:string):Promise<unknown>{
 return new Promise((done,fail)=>{
  const child=spawn(process.execPath,['scripts/native-contention-proof.mjs',resolve(process.env['VITEST_TMP_ROOT']??'tmp/vitest','native-contention'),file],{detached:true,stdio:['ignore','pipe','pipe']});
  let output='',errors='',expired=false;
  let hard:ReturnType<typeof setTimeout>|undefined;
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{errors+=data;});
  const signal=(value:NodeJS.Signals):void=>{
   if(child.pid===undefined||child.exitCode!==null||child.signalCode!==null)return;
   try{process.kill(-child.pid,value);}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ESRCH'))throw error;}
  };
  const timer=setTimeout(()=>{expired=true;signal('SIGTERM');hard=setTimeout(()=>{signal('SIGKILL');},3000);},50000);
  child.once('error',fail);
  child.once('close',code=>{
   clearTimeout(timer);clearTimeout(hard);
   if(expired||code!==0){fail(new Error(`Native contention ${expired?'deadline':String(code)}: ${errors}`));return;}
   try{done(JSON.parse(output));}catch(error){fail(error);}
  });
 });
}
