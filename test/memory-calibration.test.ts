// oxlint-disable-next-line import/no-nodejs-modules -- Read the committed calibration table.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {fitLine,fitHost,parseCalibration,compareWithProbe,median,KINDS} from '../src/scripts/memory/calibration.mjs';

const MB=1e6;
const reading=(kind:string,run:number,askedMB:number,roles:Record<string,number>,got=askedMB*MB)=>({host:'webkit',kind,run,askedMB,gotBytes:got,unit:'bytes',roles});

test('the fit is a least-squares line with its r squared',()=>{
  expect(fitLine([[0,10],[100,110],[200,210]])).toEqual({slope:1,interceptMB:10,r2:1});
  const noisy=fitLine([[0,0],[1,1.1],[2,1.9],[3,3.05]]);
  expect(noisy.slope).toBeCloseTo(0.995,2);
  expect(noisy.r2).toBeGreaterThan(0.99);
  expect(()=>fitLine([[1,1]])).toThrow();
  expect(()=>fitLine([[1,1],[1,2]])).toThrow();
});

test('a kind lands in the role with the largest slope, with a per-run spread and a baseline from none',()=>{
  const rows=[
    reading('none',1,0,{webcontent:16*MB,gpu:17*MB}),reading('none',2,0,{webcontent:17*MB,gpu:17*MB}),
    ...[1,2,3].flatMap(run=>[0,128,256,512].map(mb=>reading('texrgba',run,mb,{webcontent:16.5*MB,gpu:(18+93*(mb>0?1:0)+mb*(1+run/100))*MB}))),
    reading('arraybuffer',1,256,{webcontent:272*MB},0),
    {...reading('glbuffer',1,256,{gpu:300*MB}),error:'context lost'},
  ];
  const host=fitHost(rows);
  expect(host.baselineMB).toEqual({webcontent:16.5,gpu:17});
  const tex=host.kinds['texrgba']!;
  expect(tex.lands).toBe('gpu');
  expect(tex.sizesMB).toEqual([0,128,256,512]);
  expect(tex.spread.runs).toBe(3);
  expect(tex.spread.slopeMin).toBeLessThan(tex.spread.slopeMax);
  expect(tex.spread.at256MB).toBeCloseTo(5.1,1);
  expect(tex.roles['webcontent']!.slope).toBe(0);
  // one size only, or only failed readings: no entry
  expect(host.kinds['arraybuffer']).toBeUndefined();
  expect(host.kinds['glbuffer']).toBeUndefined();
});

test('the probe comparison reads the table at 256 MB over none, in the probe role',()=>{
  const table={baselineMB:{webcontent:16},kinds:{arraybuffer:{roles:{webcontent:{slope:1.002,interceptMB:16}}}}};
  const rows=compareWithProbe('webkit',table);
  const ab=rows.find(r=>r.kind==='arraybuffer')!;
  expect(ab.within).toBe(true);
  expect(ab.table).toBeCloseTo(1.002,3);
  expect(rows.find(r=>r.kind==='texrgba')!.within).toBe(false);
  expect(median([3,1,2])).toBe(2);
  expect(median([4,1,2,3])).toBe(2.5);
});

test('the committed table matches the schema, names every kind it fitted and holds three hosts',()=>{
  const table=parseCalibration(JSON.parse(readFileSync(new URL('../src/scripts/memory/calibration.json',import.meta.url),'utf8')));
  expect(Object.keys(table.hosts).sort()).toEqual(['chromium','simulator','webkit']);
  for(const host of Object.values(table.hosts)) {
    for(const [kind,row] of Object.entries(host.kinds)) {
      expect(KINDS).toContain(kind);
      expect(row.roles[row.lands]!.slope).toBe(row.slope);
      expect(row.spread.slopeMin).toBeLessThanOrEqual(row.spread.slopeMax);
    }
  }
  // the meter's own check (ENGINE-MEMORY Verification): an ArrayBuffer is footprint at its size in WebKit's WebContent
  const ab=table.hosts.webkit!.kinds['arraybuffer']!;
  expect(ab.lands).toBe('webcontent');
  expect(Math.abs(ab.slope-1)).toBeLessThan(0.05);
  expect(()=>parseCalibration({version:2,note:'',hosts:{}})).toThrow();
});
