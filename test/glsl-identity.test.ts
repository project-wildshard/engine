import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the installed pinned products and the committed emission hashes.
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {builtFolder} from '../src/test/game/builtFolder';
import { beginShaderSourceSession, endShaderSourceSession } from '../src/client/engine/render/shaderSourceCache';
import {shippedGraphCosts} from './fixtures/shipped-graph-costs';

// MG10 / EM18 (ENGINE-MEMORY-PLAN): a change that only makes emission cheaper keeps every shipped graph's GLSL byte for
// byte. Each installed pinned product's graphs are emitted and hashed (program, outline, fog, uniforms, attributes and
// the wrapped fragment sources) and checked against the hashes recorded here. A graph absent from the file (a new pin)
// is skipped, so pin bumps never break it. A change meant to alter shader output rewrites the file:
// `GLSL_IDENTITY=write npx vitest run test/glsl-identity.test.ts`, and says so in its commit.
const FILE='test/fixtures/glsl-identity.json';
const recorded=existsSync(FILE)?JSON.parse(readFileSync(FILE,'utf8')) as Record<string,string>:{};
const folders=(existsSync('out')?readdirSync('out'):[]).filter(folder=>existsSync(`out/${folder}/validation.json`)).sort();

async function liveIdentities(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const folder of folders) for (const row of await shippedGraphCosts(builtFolder(folder))) {
    result[row.graphHash] = [row.codeHash, row.fragmentShaderHashes.main, row.fragmentShaderHashes.outline, row.postFragmentShaderHash].join(' ');
  }
  return result;
}

test('shipped graphs emit the recorded GLSL byte for byte',async()=>{
 const now = await liveIdentities();
 if(process.env['GLSL_IDENTITY']==='write'){writeFileSync(FILE,`${JSON.stringify(Object.fromEntries(Object.entries(now).sort(([a],[b])=>a.localeCompare(b))),null,1)}\n`);return;}
 const both=Object.keys(now).filter(key=>key in recorded);
 expect(both.length).toBeGreaterThan(0);
 expect(Object.fromEntries(both.map(key=>[key,now[key]]))).toEqual(Object.fromEntries(both.map(key=>[key,recorded[key]])));
},600_000);

test('a replayed source book preserves shipped program bytes', async () => {
  const first = beginShaderSourceSession();
  let expected: Record<string, string>;
  try { expected = await liveIdentities(); } finally { endShaderSourceSession(first); }
  const second = beginShaderSourceSession(first.book);
  try {
    expect(await liveIdentities()).toEqual(expected);
    expect(second.hits.lower).toBeGreaterThan(0);
    expect(second.emitted).toEqual({ lower: 0, wrap: 0, finish: 0 });
  } finally { endShaderSourceSession(second); }
}, 600_000);
