import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The reader scans a real dist folder on disk.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Temp dist under the checkout's tmp folder.
import { join } from 'node:path';
import { buildCodeChunks, heldGoldenResidency } from '../src/scripts/goldens/native-residency.mjs';

test('a held residency wait still refuses movement and names the before/after state', async () => {
  const globals=new Map(['window','requestAnimationFrame'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const replace=(name:string,value:unknown)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  let playerX=0;
  const game={hold:true,frameCount:12,app:{clock:{snapshot:()=>({frames:12})}},camera:{matrixWorld:{elements:[1,0,0,1]}}};
  const ledger={jobs:[{id:'native-part',state:'published'}]};
  replace('window',{__wildshard:{world:{game,player:{position:{toArray:()=>[playerX,125,0]}}}},__goldenResidency:ledger});
  try {
    replace('requestAnimationFrame',(draw:FrameRequestCallback)=>{draw(0);return 1;});
    await expect(heldGoldenResidency()).resolves.toMatchObject({pending:0,heldState:{frame:12,player:[0,125,0]}});
    // Exact hosted values: a 3.7e-8 m correction straddles a rounding
    // boundary but is far smaller than one native float32 transform unit.
    expect(Math.fround(17.999985714116413)).not.toBe(Math.fround(17.99998567712444));
    playerX=17.999985714116413;
    replace('requestAnimationFrame',(draw:FrameRequestCallback)=>{playerX=17.99998567712444;draw(0);return 1;});
    await expect(heldGoldenResidency()).resolves.toMatchObject({pending:0,playerAfter:[17.99998567712444,125,0]});
    replace('requestAnimationFrame',(draw:FrameRequestCallback)=>{playerX+=0.00001;draw(0);return 1;});
    await expect(heldGoldenResidency()).rejects.toThrow('Native wait changed');
    replace('requestAnimationFrame',(draw:FrameRequestCallback)=>{game.frameCount++;draw(0);return 1;});
    await expect(heldGoldenResidency()).rejects.toThrow('Native wait changed');
    playerX=0;
    replace('requestAnimationFrame',(draw:FrameRequestCallback)=>{playerX=1;draw(0);return 1;});
    await expect(heldGoldenResidency()).rejects.toThrow(/Native wait changed.*"before".*"player":\[0,125,0\].*"after".*"player":\[1,125,0\]/u);
  } finally {
    for(const [name,descriptor] of globals) {
      if(descriptor===undefined)Reflect.deleteProperty(globalThis,name);
      else Object.defineProperty(globalThis,name,descriptor);
    }
  }
});

test('the Nine reader scans the build folder and the shared chunks its import map names', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(join('tmp', 'native-residency-'));
  try {
    mkdirSync(join(root, 'b/abc-1'), { recursive: true });
    mkdirSync(join(root, 'b/c'), { recursive: true });
    writeFileSync(join(root, 'b/abc-1/main-x.js'), '');
    writeFileSync(join(root, 'b/c/control-y.js'), '');
    writeFileSync(join(root, 'b/c/other-build-z.js'), '');
    writeFileSync(join(root, 'importmap.json'), JSON.stringify({ imports: { '/b/c/control-k.js': '/b/c/control-y.js', '/b/c/s.css': '/b/c/s-q.css' } }));
    // another build's chunk in the shared folder is never a candidate
    expect(buildCodeChunks(root, 'abc-1')).toEqual(['/b/abc-1/main-x.js', '/b/c/control-y.js']);
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets/old-a.js'), '');
    expect(buildCodeChunks(root, 'missing')).toEqual(['/assets/old-a.js']);
    // Current builds use the exact owner graph, even when an old import map remains.
    writeFileSync(join(root, 'deploy-chunks.json'), JSON.stringify({builds: [
      {build: 'abc-1', files: [{path: 'b/abc-1/main-x.js'}, {path: 'b/c/owned-new.js'}]},
      {build: 'previous', files: [{path: 'b/c/other-build-z.js'}]},
    ]}));
    expect(buildCodeChunks(root, 'abc-1')).toEqual(['/b/abc-1/main-x.js', '/b/c/owned-new.js']);
    expect(() => buildCodeChunks(root, 'missing')).toThrow('ambiguous');

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
