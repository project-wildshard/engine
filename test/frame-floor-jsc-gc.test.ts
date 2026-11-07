import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Reproduce the worker cwd in a fresh Node process.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual Python loader in an isolated scratch fixture.
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the owned filesystem fixture under repository scratch.
import {join} from 'node:path';
import {JSC_GC_SETTINGS, prepareJscGcEnvironment} from '../scripts/frame-floor-jsc-gc.mjs';
import {validateFrameFloorArgs} from '../scripts/frame-floor-args.mjs';

function fixture() {
  const values = new Map<string,string>(), calls: string[] = [];
  const port = {
    get: (name: string) => Promise.resolve(values.get(name) ?? ''),
    set: (name: string, value: string) => {calls.push(`set ${name} ${value}`); values.set(name,value); return Promise.resolve();},
    unset: (name: string) => {calls.push(`unset ${name}`); values.delete(name); return Promise.resolve();},
  };
  return {values,calls,port};
}

test('native GC diagnostics set XPC logging/options and fully unset afterward', async () => {
  expect(JSC_GC_SETTINGS).toEqual({__XPC_JSC_logGC:'2',__XPC_JSC_useOSLog:'1',__XPC_JSC_dumpOptions:'1'});
  const f=fixture(), stop=await prepareJscGcEnvironment(f.port);
  expect([...f.values]).toEqual([['__XPC_JSC_logGC','2'],['__XPC_JSC_useOSLog','1'],['__XPC_JSC_dumpOptions','1']]);
  await stop();
  expect(f.values.size).toBe(0);
  expect(f.calls).toEqual(['set __XPC_JSC_logGC 2','set __XPC_JSC_useOSLog 1','set __XPC_JSC_dumpOptions 1',
    'unset __XPC_JSC_dumpOptions','unset __XPC_JSC_useOSLog','unset __XPC_JSC_logGC']);
});

test('existing foreign launchd setting refuses before changing any option', async () => {
  const f=fixture();f.values.set('__XPC_JSC_useOSLog','info');
  await expect(prepareJscGcEnvironment(f.port)).rejects.toThrow('Refusing existing');
  expect(f.calls).toEqual([]);expect([...f.values]).toEqual([['__XPC_JSC_useOSLog','info']]);
});

test('partial setup failure clears both attempted settings and keeps the original failure', async () => {
  const f=fixture(), failure=new Error('set failed');
  const port={...f.port,set:async(name:string,value:string)=>{await f.port.set(name,value);if(name==='__XPC_JSC_useOSLog')throw failure;}};
  await expect(prepareJscGcEnvironment(port)).rejects.toBe(failure);
  expect(f.values.size).toBe(0);expect(f.calls.slice(-2)).toEqual(['unset __XPC_JSC_useOSLog','unset __XPC_JSC_logGC']);
});

test('cleanup attempts every option and refuses a setting that remains', async () => {
  const f=fixture();
  const stop=await prepareJscGcEnvironment({...f.port,unset:name=>{
    if(name==='__XPC_JSC_useOSLog')return Promise.resolve();
    return f.port.unset(name);
  }});
  await expect(stop()).rejects.toThrow('__XPC_JSC_useOSLog');
  expect(f.values.has('__XPC_JSC_logGC')).toBe(false);
  expect(f.values.has('__XPC_JSC_dumpOptions')).toBe(false);
});

test('native logging permits only a Simulator grid visit with no other recorders', () => {
  const args=['--surface=sim','--shards=grid','--grid-scenario=all','--jsc-gc-log=tmp/native','--quiet'];
  expect(()=>validateFrameFloorArgs(args)).not.toThrow();
  for(const extra of ['--webkit-timeline=tmp/timeline','--safari-profile=tmp/profile','--native-pressure=tmp/pressure','--buffer-ablation','--gl-time'])
    expect(()=>validateFrameFloorArgs([...args,extra])).toThrow('Native JSC');
  expect(()=>validateFrameFloorArgs(args.filter(arg=>arg!=='--surface=sim'))).toThrow();
  expect(()=>validateFrameFloorArgs([...args,'--jsc-gc-log=tmp/second'])).toThrow('Native JSC');
});

test('missing launchd readback refuses and clears the attempted setting', async () => {
  const f=fixture();
  await expect(prepareJscGcEnvironment({...f.port,set:()=>Promise.resolve()})).rejects.toThrow('not retained');
  expect(f.calls).toEqual(['unset __XPC_JSC_logGC']);
  expect(f.values.size).toBe(0);
});

test('failed XPC option dump setup clears all three attempted settings', async () => {
  const f=fixture(), failure=new Error('option dump failed');
  await expect(prepareJscGcEnvironment({...f.port,set:async(name,value)=>{
    await f.port.set(name,value);if(name==='__XPC_JSC_dumpOptions')throw failure;
  }})).rejects.toBe(failure);
  expect(f.values.size).toBe(0);
  expect(f.calls.slice(-3)).toEqual(['unset __XPC_JSC_dumpOptions','unset __XPC_JSC_useOSLog','unset __XPC_JSC_logGC']);
});

test('WebContent identity loads the real watchdog from a worker scratch cwd', () => {
  const root=join(import.meta.dirname,'..');
  const scratch=mkdtempSync(join(root,'tmp','jsc-path-'));
  try {
    const bin=join(scratch,'bin');mkdirSync(bin);
    // Run the real Python loader, replacing only native process queries.
    writeFileSync(join(bin,'python3'),`#!/usr/bin/python3
import sys,runpy
original=runpy.run_path
def load(path):
    module=original(path)
    assert callable(module['simulator_processes'])
    return {'command':lambda args:'123','simulator_processes':lambda *args:{456:{}}}
runpy.run_path=load
code=sys.argv[2]
sys.argv=['-c',*sys.argv[3:]]
exec(code)
`,{mode:0o755});
    const module=new URL('../scripts/frame-floor-jsc-gc.mjs',import.meta.url).href;
    const code=`const m=await import(${JSON.stringify(module)});console.log(JSON.stringify(m.jscGcProcessIds('fixture')));`;
    expect(execFileSync(process.execPath,['--input-type=module','-e',code],{
      cwd:scratch,encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env['PATH'] ?? ''}`},
    })).toBe('[456]\n');
  } finally { rmSync(scratch,{recursive:true,force:true}); }
});

test('explicit diagnostic RAM override is verified and removed with the log settings', async () => {
  const f=fixture(), stop=await prepareJscGcEnvironment(f.port,6442450944);
  expect(f.values.get('__XPC_JSC_forceRAMSize')).toBe('6442450944');
  await stop();
  expect(f.values.size).toBe(0);
  expect(f.calls.slice(-4)).toEqual(['unset __XPC_JSC_forceRAMSize','unset __XPC_JSC_dumpOptions',
    'unset __XPC_JSC_useOSLog','unset __XPC_JSC_logGC']);
  const foreign=fixture();foreign.values.set('__XPC_JSC_forceRAMSize','123');
  await expect(prepareJscGcEnvironment(foreign.port,6442450944)).rejects.toThrow('Refusing existing');
  expect(foreign.calls).toEqual([]);
});

test('RAM override refuses malformed or standalone CLI values before starting native logging', async () => {
  const args=['--surface=sim','--shards=grid','--grid-scenario=all','--jsc-gc-log=tmp/native'];
  expect(()=>validateFrameFloorArgs([...args,'--jsc-ram-size=6442450944'])).not.toThrow();
  for(const value of ['','0','-1','1.5','NaN','9007199254740992'])
    expect(()=>validateFrameFloorArgs([...args,`--jsc-ram-size=${value}`])).toThrow('Native JSC RAM');
  expect(()=>validateFrameFloorArgs(['--jsc-ram-size=6442450944'])).toThrow('Native JSC RAM');
  expect(()=>validateFrameFloorArgs([...args,'--jsc-ram-size=1','--jsc-ram-size=2'])).toThrow('Native JSC RAM');
  const f=fixture();
  for(const value of [-1,Number.NaN,Number.POSITIVE_INFINITY,1.5])
    await expect(prepareJscGcEnvironment(f.port,value)).rejects.toThrow('Invalid diagnostic');
  expect(f.calls).toEqual([]);
});
