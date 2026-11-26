import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseJetsam,parseSyslog,parseSysmon,jetsamLines,commands,main} from '../src/scripts/memory/iphone-footprint.mjs';

const fixture=(name:string)=>readFileSync(new URL(`fixtures/iphone-memory/${name}`,import.meta.url),'utf8');

test('a JetsamEvent report reads as pages x page size, the killed process and the largest one',()=>{
  const j=parseJetsam(fixture('JetsamEvent-sample.ips'));
  expect(j).toMatchObject({largestProcess:'com.apple.WebKit.WebContent',pageSize:16384,date:'2026-11-10 21:14:03.41 -0500'});
  expect(j.rows.map(r=>r.name)).toEqual(['com.apple.WebKit.WebContent','com.apple.WebKit.GPU','MobileSafari','com.apple.WebKit.Networking']);
  expect(j.killed).toEqual([{name:'com.apple.WebKit.WebContent',pid:1888,pages:78643,bytes:78643*16384,lifetimeMaxBytes:78700*16384,reason:'per-process-limit'}]);
  const lines=jetsamLines(j);
  expect(lines[1]).toMatch(/com\.apple\.WebKit\.WebContent +1288 MB  78643 pages  killed: per-process-limit/u);
  expect(lines).toHaveLength(5);
});

test('the syslog sample yields the limit and its crossing, nothing else',()=>{
  const hits=fixture('syslog-sample.txt').split('\n').map(parseSyslog).filter(h=>h!==null);
  expect(hits.map(h=>h.kind)).toEqual(['limits','exceeded']);
  expect(hits[0]).toMatchObject({kind:'limits',activeMB:1228,inactiveMB:1228});
  expect(hits[1]).toMatchObject({kind:'exceeded',process:'com.apple.WebKit.WebContent',pid:1888,limit:'ActiveHard',limitMB:1228,fatal:true});
});

test('a sysmon line reads, and a broken one does not',()=>{
  expect(parseSysmon('{"name":"com.apple.WebKit.GPU","pid":1886,"physFootprint":499712000}')).toEqual({name:'com.apple.WebKit.GPU',pid:1886,physFootprint:499712000});
  expect(parseSysmon('not json')).toBeNull();
  expect(parseSysmon('{"name":"x"}')).toBeNull();
});

test('--dry-run prints every command; with no device the script exits 1 and says so',async()=>{
  const log:string[]=[];
  expect(await main(['--dry-run','--seconds=60','--out=tmp/x'],{log:l=>log.push(l)})).toBe(0);
  expect(log).toHaveLength(5);
  expect(log[1]).toContain('developer dvt sysmon process monitor process --filter name=com.apple.WebKit.WebContent');
  expect(log[1]).toContain('--interval 500 --duration 60000');
  expect(log[3]).toMatch(/syslog live$/u);
  expect(log[4]).toContain('crash pull');
  const none:string[]=[];
  expect(await main([],{devices:()=>[],log:l=>none.push(l)})).toBe(1);
  expect(none[0]).toMatch(/no iPhone attached/u);
  expect(commands({udid:'abc',seconds:5,out:'o'}).syslog.slice(-2)).toEqual(['--udid','abc']);
});
