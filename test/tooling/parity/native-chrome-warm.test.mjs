import {test,expect} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise complete native-file reads in an owned temporary installation, without launching a browser.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync,existsSync,realpathSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All fake installation and resource paths stay in repository scratch.
import {resolve,join} from 'node:path';
import {warmNativeChrome} from '../../../scripts/warm-native-chrome.mjs';

test('warm-up reads the complete selected native binary and resource packs through its launcher without executing it',async()=>{
  const root=mkdtempSync(resolve('tmp/native-chrome-files-'));
  try{
    const directory=join(root,'installation'),launch=join(directory,'google-chrome'),binary=join(directory,'chrome');
    mkdirSync(join(directory,'locales'),{recursive:true});mkdirSync(join(directory,'swiftshader'));
    const sentinel=join(root,'executed');
    writeFileSync(launch,`#!/bin/sh\ntouch '${sentinel}'\nexit 77\n`,{mode:0o700});
    const original=new Map([
      [binary,Buffer.concat([Buffer.from([0x7f,0x45,0x4c,0x46]),Buffer.alloc(2*1024*1024+17,91)])],
      [join(directory,'resources.pak'),Buffer.alloc(1024*1024+31,38)],
      [join(directory,'chrome_100_percent.pak'),Buffer.from('actual scaled resources')],
      [join(directory,'icudtl.dat'),Buffer.from('actual ICU input')],
      [join(directory,'v8_context_snapshot.bin'),Buffer.from('actual startup snapshot')],
      [join(directory,'libEGL.so'),Buffer.from('actual native shared library')],
      [join(directory,'libvulkan.so.1'),Buffer.from('actual versioned shared library')],
      [join(directory,'chrome_crashpad_handler'),Buffer.from('actual handler')],
      [join(directory,'locales/en-US.pak'),Buffer.from('actual locale')],
      [join(directory,'swiftshader/libGLESv2.so'),Buffer.from('actual bundled library')],
    ]);
    for(const [path,bytes] of original)writeFileSync(path,bytes);
    writeFileSync(join(directory,'unrelated.txt'),'unrelated to startup');
    const selected=join(root,'google-chrome-link');symlinkSync(launch,selected);
    const result=await warmNativeChrome(selected);
    const actual=new Map(result.files.map(file=>[file.path,file.bytes]));
    const expected=new Map([...original].map(([path,bytes])=>[realpathSync(path),bytes.length]));
    expected.set(realpathSync(launch),readFileSync(launch).length);
    expect(actual).toEqual(expected);
    expect(result.executable).toBe(selected);expect(result.binary).toBe(realpathSync(binary));
    expect(result.bytes).toBe([...expected.values()].reduce((sum,bytes)=>sum+bytes,0));
    for(const [path,bytes] of original)expect(readFileSync(path)).toEqual(bytes);
    expect(existsSync(sentinel)).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('a direct native binary is read completely without requiring a launcher',async()=>{
  const root=mkdtempSync(resolve('tmp/native-chrome-direct-'));
  try{
    const binary=join(root,'chrome'),bytes=Buffer.from([0x7f,0x45,0x4c,0x46,4,8,12]);writeFileSync(binary,bytes);
    const result=await warmNativeChrome(binary);
    expect(result.binary).toBe(realpathSync(binary));
    expect(result.files).toEqual([{path:realpathSync(binary),bytes:bytes.length}]);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('missing or ambiguous launcher binaries refuse preparation instead of launching or selecting another browser',async()=>{
  const root=mkdtempSync(resolve('tmp/native-chrome-refusal-'));
  try{
    const launcher=join(root,'google-chrome');writeFileSync(launcher,'#!/bin/sh\nexit 77\n');
    await expect(warmNativeChrome(launcher)).rejects.toThrow('Cannot identify');
    for(const name of ['chrome','chromium'])writeFileSync(join(root,name),Buffer.from([0x7f,0x45,0x4c,0x46]));
    await expect(warmNativeChrome(launcher)).rejects.toThrow('Cannot identify');
    await expect(warmNativeChrome(join(root,'missing'))).rejects.toMatchObject({code:'ENOENT'});
  }finally{rmSync(root,{recursive:true,force:true});}
});
