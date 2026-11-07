// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Capture files live only in this test's owned repository scratch directory.
import {mkdtempSync,mkdirSync,rmSync,readFileSync,existsSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Own paths, never a shell or external screenshot command.
import {join} from 'node:path';
import sharp from 'sharp';
import {expect,test,vi} from 'vitest';
import {captureNativePhonePage} from '../scripts/parity/phone-route-browser.mjs';

function output(){mkdirSync('tmp',{recursive:true});const root=mkdtempSync('tmp/native-phone-capture-');return {png:join(root,'frame.png'),jpg:join(root,'failure.jpg'),close:()=>{rmSync(root,{recursive:true,force:true});}};}

test('native capture requests the real viewport and preserves its pixels for PNG and diagnostic JPEG',async()=>{
  const out=output(),png=await sharp({create:{width:32,height:64,channels:4,background:'#123456'}}).png().toBuffer();
  const calls:{method:string;params?:object}[]=[];
  const port={send:(method:string,params?:object):Promise<unknown>=>{
    calls.push({method,...(params===undefined?{}:{params})});
    return Promise.resolve(method==='Runtime.evaluate'?{result:{value:{width:16,height:32}}}:{dataURL:`data:image/png;base64,${png.toString('base64')}`});
  }};
  try {
    for(const path of [out.png,out.jpg]){
      const bytes=await captureNativePhonePage(port,path),image=sharp(bytes),meta=await image.metadata();
      expect(meta.width).toBe(32);expect(meta.height).toBe(64);expect(meta.format).toBe(path.endsWith('jpg')?'jpeg':'png');
      expect(readFileSync(path)).toEqual(bytes); // actual file publication, not a historical output pin
      const stats=await image.stats();expect(stats.channels[0]?.mean).toBeCloseTo(18,-1);expect(stats.channels[2]?.mean).toBeCloseTo(86,-1);
    }
    expect(calls.filter(row=>row.method==='Page.snapshotRect').map(row=>row.params)).toEqual([
      {x:0,y:0,width:16,height:32,coordinateSystem:'Viewport'},
      {x:0,y:0,width:16,height:32,coordinateSystem:'Viewport'},
    ]);
  }finally{out.close();}
});

test('missing or invalid native pixels refuse without a substitute capture',async()=>{
  const out=output();try {
    for(const dataURL of ['data:text/html;base64,AAAA','data:image/png;base64,AAAA']){
      const port={send:(method:string)=>Promise.resolve(method==='Runtime.evaluate'?{result:{value:{width:16,height:32}}}:{dataURL})};
      await expect(captureNativePhonePage(port,out.png)).rejects.toThrow();expect(existsSync(out.png)).toBe(false);
    }
    const error=new Error('native page retired');
    await expect(captureNativePhonePage({send:()=>Promise.reject(error)},out.png)).rejects.toBe(error);
    expect(existsSync(out.png)).toBe(false);
  }finally{out.close();}
});

test('undelivered native capture retains its original ten-second limit and clears its timer',async()=>{
  const out=output();vi.useFakeTimers();try {
    const capture=captureNativePhonePage({send:()=>new Promise(()=>{/* Native port deliberately never replies. */})},out.png);
    const refused=expect(capture).rejects.toThrow('original 10s deadline');
    await vi.advanceTimersByTimeAsync(9999);expect(existsSync(out.png)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);await refused;expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();out.close();}
});
