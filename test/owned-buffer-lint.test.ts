import {expect,test} from 'vitest';
import {parseSync} from 'vite';
import {bufferPath,bufferSites,OWNED_BUFFER_SCOPE} from '../lint/owned-buffer.mjs';
import {countBufferDebt} from '../src/scripts/memory/owned-buffer-debt.mjs';
import debt from '../lint/owned-buffer-debt.json' with {type:'json'};

function sites(source:string):number{
  const parsed=parseSync('src/example.ts',source);expect(parsed.errors).toEqual([]);
  return bufferSites(parsed.program);
}

test('big-buffer syntax: buffers, sized and copying typed arrays, buffer slices',()=>{
  expect(sites(`new ArrayBuffer(n); new SharedArrayBuffer(8); new globalThis.ArrayBuffer(4);
    new Float32Array(count * 3); new Uint8Array(other); new Float64Array(8192); new Uint16Array(32768 as number);
    bytes.buffer.slice(0, 10); view.buffer.slice();`)).toBe(9);
  expect(sites(`new Float32Array(3); new Uint8Array([1, 2, 3]); new Uint8Array(buffer, 0, 16); new Float64Array(8191);
    new Uint32Array(...rows); list.slice(1); bytes.slice(0, 4); new Map(); new Array(100000);`)).toBe(0);
});

test('scope: client and shared source, never tests or the helper',()=>{
  expect(bufferPath('/x/engine/src/client/a.ts')).toBe('src/client/a.ts');
  expect(OWNED_BUFFER_SCOPE.test('src/shared/engine/core/x.ts')).toBe(true);
  expect(OWNED_BUFFER_SCOPE.test('src/server/game/x.ts')).toBe(false);
  expect(OWNED_BUFFER_SCOPE.test('src/client/game/x.test.ts')).toBe(false);
});

test('the committed debt covers the tree: no file has more sites than its allowance',()=>{
  const now=countBufferDebt(),allowed:Record<string,number>=debt.files;
  expect(Object.entries(now).filter(([file,count])=>count>(allowed[file]??0))).toEqual([]);
});
