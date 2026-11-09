// Manual Ring 2: the control deliberately runs the complete cold client-page bake,
// whose hosted preparation can exceed ten seconds. Never register this proof in a commit or push hook.
// Run after pinned products are prepared: node --test test/manual/grid-collision-bake.proof.mjs
// oxlint-disable-next-line import/no-nodejs-modules -- Compare actual CLI output bytes, not a supplied bake verdict.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real cold production baker in its own process.
import {execFile} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Retain exact output identities in the manual receipt.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Read real products and clean only this proof's created output directory.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compose only the proof's own local paths.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Manual Ring 2 proof, excluded from Vitest's test-file glob.
import test from 'node:test';
// oxlint-disable-next-line import/no-nodejs-modules -- Await the actual child process and its unchanged deadline.
import {promisify} from 'node:util';
import {holdCpu} from '../../scripts/cpu-admission.mjs';

await test('the worker-only cold bake retains every plain-grid collision byte', {timeout:180_000}, async()=>{
  for(const slug of ['sunscar-dunes','pastel-plain','driftwood-isle','nine-dragon-stack','nalati-grasslands'])
    assert.ok(existsSync(join('out',slug,'shard.json')),`Prepare the actual pinned ${slug} product`);
  const {VITEST_TMP_ROOT:temporaryRoot}=process.env;
  const parent=temporaryRoot??'tmp';mkdirSync(parent,{recursive:true});
  const scratch=mkdtempSync(join(parent,'grid-collision-bake-')),lease=await holdCpu(4);
  try{
    /** @param {string} name @param {string[]} [extra] */
    const bake=async(name,extra=[])=>{
      const output=join(scratch,name),started=performance.now();
      await promisify(execFile)(process.execPath,['--experimental-transform-types','--import','./scripts/bake-loader.mjs','scripts/bake-grid-seams.mjs',output,...extra],{maxBuffer:64*1024*1024,timeout:55_000});
      return {output,milliseconds:performance.now()-started};
    };
    const collision=await bake('collision',['--collision-only']);
    assert.equal(existsSync(join(collision.output,'out/.app/grid-strip-index.json')),false,'A worker collision request must not compile client page packs');
    const full=await bake('full');
    assert.ok(existsSync(join(full.output,'out/.app/grid-strip-index.json')),'The normal production bake still builds client pages');
    const files=['strips.json','shapes.bin'].map(name=>{
      const bytes=readFileSync(join(collision.output,'out/.app/grid-collision',name));
      assert.deepEqual(bytes,readFileSync(join(full.output,'out/.app/grid-collision',name)),`${name} keeps all original collision bytes`);
      return {name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    });
    console.info(JSON.stringify({proof:'cold-grid-collision-bytes',grant:lease.proof,collisionMs:collision.milliseconds,fullMs:full.milliseconds,files}));
  }finally{await lease.release();rmSync(scratch,{recursive:true,force:true});}
});
