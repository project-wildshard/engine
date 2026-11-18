import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the installed pinned products and the committed emission hashes.
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {builtFolder} from '../src/test/game/builtFolder';
import {shippedGraphCosts} from './fixtures/shipped-graph-costs';

// MG10 / EM18 (ENGINE-MEMORY-PLAN): a change that only makes emission cheaper keeps every shipped graph's GLSL byte for
// byte. Each installed pinned product's graphs are emitted and hashed (program, outline, fog, uniforms, attributes and
// the wrapped fragment sources) and checked against the hashes recorded here. A graph absent from the file (a new pin)
// is skipped, so pin bumps never break it. A change meant to alter shader output rewrites the file:
// `GLSL_IDENTITY=write npx vitest run test/glsl-identity.test.ts`, and says so in its commit.
const FILE='test/fixtures/glsl-identity.json';
const recorded=existsSync(FILE)?JSON.parse(readFileSync(FILE,'utf8')) as Record<string,string>:{};
const folders=(existsSync('out')?readdirSync('out'):[]).filter(folder=>existsSync(`out/${folder}/validation.json`)).sort();

test('shipped graphs emit the recorded GLSL byte for byte',async()=>{
 const now:Record<string,string>={};
 for(const folder of folders)for(const row of await shippedGraphCosts(builtFolder(folder))){
  now[row.graphHash]=[row.codeHash,row.fragmentShaderHashes.main,row.fragmentShaderHashes.outline,row.postFragmentShaderHash].join(' ');
 }
 if(process.env.GLSL_IDENTITY==='write'){writeFileSync(FILE,`${JSON.stringify(Object.fromEntries(Object.entries(now).sort(([a],[b])=>a.localeCompare(b))),null,1)}\n`);return;}
 const both=Object.keys(now).filter(key=>key in recorded);
 expect(both.length).toBeGreaterThan(0);
 expect(Object.fromEntries(both.map(key=>[key,now[key]]))).toEqual(Object.fromEntries(both.map(key=>[key,recorded[key]])));
},600_000);
