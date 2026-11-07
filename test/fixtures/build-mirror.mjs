// Real mirror/lease fixture. Kept outside tmp so the G670 caller guard stays enabled.
import {openMirror} from '../../scripts/build-mirror.mjs';
import {existsSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),root=process.env.FIXTURE_ROOT;
if(root===undefined)throw new Error('Missing owned fixture root');
const mirror=openMirror(args[1],{repo:join(root,'repo'),slot:process.env.FIXTURE_SLOT??'check',linkModules:false});
try{
  const role=process.env.ROLE;
  if(role==='preview'||role==='pool'){
    // The parent treats existence as readiness; publish only the complete path.
    const marker=join(root,role==='preview'?'preview.locked':`pool-${process.pid}.locked`),pending=`${marker}.pending`;
    writeFileSync(pending,mirror.dir);renameSync(pending,marker);
    const until=Date.now()+12000;
    while(!existsSync(join(root,role==='preview'?'preview.go':'pool.go'))){
      if(Date.now()>until)throw new Error(`${role} timed out`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    }
  }
  const cmd=args.slice(args.indexOf('--')+1);
  const child=spawnSync(cmd[0],cmd.slice(1),{cwd:mirror.dir,env:process.env,stdio:'inherit'});
  process.exitCode=child.status??1;
}finally{mirror.release();}
