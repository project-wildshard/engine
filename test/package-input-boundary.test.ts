// oxlint-disable-next-line import/no-nodejs-modules -- Own a real installed-author input boundary.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only this proof's owned files.
import {resolve} from 'node:path';
import {expect,test} from 'vitest';
import {captureFolderInputs,inputRecorderPlugin,folderInputKey,recordBundle} from '../scripts/shardfile-inputs.mjs';
import {InputHashMemo} from '../scripts/input-hash-memo.mjs';
import {build} from 'vite';

test('a real author bundle retains its receipt after ordinary parent-directory probes',async()=>{
  mkdirSync('tmp',{recursive:true});
  const parent=mkdtempSync(resolve('tmp/package-input-boundary-')),root=resolve(parent,'app');
  mkdirSync(root);const entry=resolve(root,'entry.ts'),receipt=resolve(root,'receipt.json');
  writeFileSync(entry,'export const answer=42;\n');
  try{
    await captureFolderInputs(root,receipt,async()=>{
      // Vite/Node probe the containing folder while resolving the real author
      // program. Its exact parent is outside the authored input root.
      expect(existsSync(resolve(root,'..'))).toBe(true);
      expect(statSync(resolve(root,'..')).isDirectory()).toBe(true);
      const result=await build({root,configFile:false,publicDir:false,logLevel:'silent',plugins:[inputRecorderPlugin()],build:{write:false,minify:false,lib:{entry,formats:['es'],fileName:'fixture'}}});
      recordBundle(result);
      const output=Array.isArray(result)?result[0]:result;
      if(output===undefined||!('output'in output))throw new Error('No real author output');
      const chunk=output.output.find(row=>row.type==='chunk');if(chunk===undefined)throw new Error('No actual author chunk');
      const published:unknown=await import(`data:text/javascript,${encodeURIComponent(chunk.code)}`);
      expect(published).toMatchObject({answer:42});
    });
    const memo=new InputHashMemo(root);
    expect(folderInputKey(root,receipt,[],memo)).toMatch(/^[a-f0-9]{64}$/u);
    writeFileSync(entry,'export const answer=43;\n');
    expect(folderInputKey(root,receipt,[],memo)).toBeUndefined();
    writeFileSync(resolve(parent,'outside.txt'),'owned outside fixture');
    symlinkSync(resolve(parent,'outside.txt'),resolve(root,'linked.txt'));
    await expect(captureFolderInputs(root,resolve(root,'linked-receipt.json'),async()=>{
      readFileSync(resolve(root,'linked.txt'));
      const result=await build({root,configFile:false,publicDir:false,logLevel:'silent',plugins:[inputRecorderPlugin()],build:{write:false,lib:{entry,formats:['es'],fileName:'fixture'}}});
      recordBundle(result);
    })).rejects.toThrow('Linked product input');
  }finally{rmSync(parent,{recursive:true,force:true});}
});
