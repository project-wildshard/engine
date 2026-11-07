// oxlint-disable-next-line import/no-nodejs-modules -- Own disposable fixture trees below repository scratch.
import {existsSync,mkdirSync,mkdtempSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A finished child gives this test a pid that is really dead.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own disposable fixture trees below repository scratch.
import {join,resolve} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {age,pruneCompileCache,sweepTestScratch,sweepVitestRuns} from '../scripts/temp-janitor.mjs';

const owned:string[]=[],HOUR=3_600_000,now=Date.now();
afterEach(()=>{for(const path of owned.splice(0))rmSync(path,{recursive:true,force:true});});
function root():string {mkdirSync('tmp',{recursive:true});const path=mkdtempSync(resolve('tmp/temp-janitor-'));owned.push(path);return path;}
function aged(path:string,hours:number,file=false):string {
 if(file)writeFileSync(path,'x'.repeat(8192));else mkdirSync(path,{recursive:true});
 const at=new Date(now-hours*HOUR);utimesSync(path,at,at);return path;
}
const deadPid=():number=>{const pid=spawnSync('true').pid;if(pid===undefined)throw new Error('No child pid');return pid;};

test('a vitest run dir goes only once its process is dead and idle for an hour',()=>{
 const base=root(),runs=join(base,'tmp/vitest');
 const killed=aged(join(runs,String(deadPid())),2),recent=aged(join(runs,'4194301'),0.1),live=aged(join(runs,String(process.pid)),2),named=aged(join(runs,'notes'),2);
 expect(sweepVitestRuns(base,{now})).toBe(1);
 expect(existsSync(killed)).toBe(false);
 for(const path of [recent,live,named])expect(existsSync(path)).toBe(true);
});

test('a folder another lane removed mid-sweep counts as new, not as an error',()=>{
 expect(age(join(root(),'gone'),now)).toBe(0);
});

test('test scratch older than a day goes and lane folders never do',()=>{
 const base=root(),tmp=join(base,'tmp');
 const old=['push-config-EGEmSC','sim-readiness-test-0k4wb28h','nine-declaration-T8tA24','author-module-07mV3d'].map(name=>aged(join(tmp,name),25));
 const kept=[aged(join(tmp,'push-config-LPZhjA'),2),aged(join(tmp,'sp-x8-z6'),900),aged(join(tmp,'flip-save'),900),aged(join(tmp,'push-loop'),900)];
 expect(sweepTestScratch(base,{now,dryRun:true})).toBe(4);
 for(const path of old)expect(existsSync(path)).toBe(true);
 expect(sweepTestScratch(base,{now})).toBe(4);
 for(const path of old)expect(existsSync(path)).toBe(false);
 for(const path of kept)expect(existsSync(path)).toBe(true);
});

test('the compile cache keeps a day, then the newest under its cap',()=>{
 const version=aged(join(root(),'cache/v24-arm64'),0),cache=join(version,'..');
 const stale=aged(join(version,'stale'),30,true),old=aged(join(version,'old'),3,true),mid=aged(join(version,'mid'),2,true),fresh=aged(join(version,'fresh'),1,true);
 const report=pruneCompileCache(cache,{now,capBytes:10_000});
 expect(report.files).toBe(4);
 expect(report.removed).toBe(3);
 expect(report.keptBytes).toBeLessThanOrEqual(10_000);
 for(const path of [stale,old,mid])expect(existsSync(path)).toBe(false);
 expect(existsSync(fresh)).toBe(true);
 expect(pruneCompileCache(join(cache,'absent'),{now})).toEqual({files:0,beforeBytes:0,removed:0,keptBytes:0});
});
