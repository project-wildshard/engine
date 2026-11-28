import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseSync} from 'vite';
import {frameAllocSites} from '../lint/no-frame-alloc.mjs';

// Meta QA 11-26 row 81: Nine's online walk read 19.4 MB/s allocated [S] against its 3.56 MB/s baseline. Since the walk boots
// Nine's one-cell grid world (engine efed7f5a6, no longer the chunk address), its two largest sites were the placed
// culler's `level` (4.6 MB/s: View.sees copied each tested copy's sphere into a held one and grew its radius) and the
// environment fold's `folded` (2.6 MB/s: an argument array and a spread per draw). Both are written to make nothing per call;
// these hold the shape, and walk-ci holds the rate (walk/nine-dragon-stack/rate).

const body=(text,start)=>{const at=text.indexOf(start);expect(at,start).toBeGreaterThan(-1);let depth=0;for(let i=text.indexOf('{',at);i<text.length;i++){if(text[i]==='{')depth++;else if(text[i]==='}'&&--depth===0)return text.slice(at,i+1);}throw new Error(`no end to ${start}`);};

test('QA 11-26 row 81: the culler\'s View.sees tests the planes itself and writes no field or copy',()=>{
  const sees=body(readFileSync('src/client/engine/models/cull.ts','utf8'),'  sees(sphere: THREE.Sphere): boolean {');
  expect(sees).not.toMatch(/\.copy\(/u);
  expect(sees,'a field written per copy tested').not.toMatch(/this(?:\.\w+)+\s*[-+*/]?=(?!=)/u);
  expect(sees).toMatch(/plane\.constant < reach/u);
});

test('QA 11-26 row 81: the environment fold passes each draw on with no argument list, under the frame lint',()=>{
  const text=readFileSync('src/client/engine/render/programFold.ts','utf8');
  expect(text).not.toMatch(/Reflect\.apply\(call, renderer, \[/u);
  const parsed=parseSync('src/client/engine/render/programFold.ts',text);expect(parsed.errors).toEqual([]);
  const lines=text.split('\n'),folded=lines.findIndex(line=>line.includes('const folded: Call = function folded')),pass=lines.findIndex(line=>line.includes('const pass = ('));
  expect(folded).toBeGreaterThan(-1);expect(pass).toBeGreaterThan(-1);
  expect(lines[folded-1],'folded is a frame function').toMatch(/@frame/u);
  expect(lines[pass-1],'pass is a frame function').toMatch(/@frame/u);
  const from=text.indexOf(lines[pass]??''),to=text.indexOf('Reflect.set(renderer, name, folded)');
  const sites=frameAllocSites(parsed.program,text).filter(site=>site.start>=from&&site.start<to);
  expect(sites,'garbage per draw').toEqual([]);
});
