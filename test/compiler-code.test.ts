// oxlint-disable-next-line import/no-nodejs-modules -- Hash owned compiler source fixtures.
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {compilerCodeHash} from '../scripts/compiler-code.mjs';

function identity(source:string):string {
  const bytes=new TextEncoder().encode(source),hash=createHash('sha256').update(bytes).digest('hex');
  return compilerCodeHash('compiler.ts',hash,()=>bytes);
}
it('normalizes emitted-code documentation and whitespace while retaining executable changes',()=>{
  const before=identity('/** reader */ export function read(x: number) { return x + 1; }');
  expect(identity('/** extra documentation */\nexport function read( x : number ) {\n  return x + 1;\n}\n')).toBe(before);
  expect(identity('export function read(x: number) { return x + 2; }')).not.toBe(before);
  expect(identity('export function read(x: string) { return x + 1; }')).toBe(before);
});
it('retains literal whitespace, regex tokens, template contents and automatic semicolons',()=>{
  expect(identity('export const x = /a b/;')).not.toBe(identity('export const x = /a  b/;'));
  expect(identity('export const x = "a b";')).not.toBe(identity('export const x = "a  b";'));
  expect(identity('export const x = `a b`;')).not.toBe(identity('export const x = `a  b`;'));
  expect(identity('export function x(){return\n1;}')).not.toBe(identity('export function x(){return 1;}'));
});
it('refuses a different read than the digest the caller just verified',()=>{
  expect(()=>compilerCodeHash('changed.ts','0'.repeat(64),()=>new TextEncoder().encode('export const x=1;'))).toThrow('Compiler input changed');
});
it('retains source bytes consumed by loader macros and bundler annotations',()=>{
  for(const marker of ['import.meta.glob','import.meta.env','@__PURE__','#__PURE__','@vite-ignore']) {
    expect(identity(`/** ${marker} first docs */ export const value=1;`)).not.toBe(identity(`/** ${marker} changed docs */ export const value=1;`));
  }
});
