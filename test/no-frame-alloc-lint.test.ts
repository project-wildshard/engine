import {expect,test} from 'vitest';
import {parseSync} from 'vite';
import {frameAllocSites,frameAllocPath,frameTagged,FRAME_ALLOC_SCOPE} from '../lint/no-frame-alloc.mjs';
import {countFrameAllocDebt} from '../src/scripts/memory/frame-alloc-debt.mjs';
import debt from '../lint/no-frame-alloc-debt.json' with {type:'json'};

// MEMORY-STRUCTURE STR21: a function tagged `@frame` allocates nothing each call. The fixture's tagged function holds a
// closure and an array literal; the untagged twin holds the same and is not counted.
function kinds(source:string):string[]{
  const parsed=parseSync('src/example.ts',source);expect(parsed.errors).toEqual([]);
  return frameAllocSites(parsed.program,source).map(site=>site.kind);
}

test('a tagged function: a closure and an array literal are caught; the untagged twin is not',()=>{
  const body='{ const hits = [a, b]; return list.some((x) => x > hits.length); }';
  expect(kinds(`/** Per frame. @frame */\nfunction cull(list: number[], a: number, b: number) ${body}\nfunction twin(list: number[], a: number, b: number) ${body}`))
    .toEqual(['array','closure']);
});

test('every allocating syntax counts; scratch state, loops by index and error paths do not',()=>{
  expect(kinds(`class C {
  // @frame: the view
  step(xs: number[], m: Map<number, number>): number {
    const o = { x: 1 }; const v = new Vector3(); f(...xs); const s = \`\${xs.length}\`;
    for (const x of xs) g(x); const ys = xs.map(h).filter(Boolean); m.keys(); xs.slice(1);
    const zs = Array.from(xs); frame.of(v, 1);
    return o.x + v.x + s.length + ys.length + zs.length;
  }
}`)).toEqual(['object','new','spread','template','for-of','filter()','map()','keys()','slice()','from()']);
  expect(kinds(`/** @frame */
export function clean(xs: Float32Array, scratch: { n: number }): number {
  let t = 0; for (let i = 0; i < xs.length; i++) t += xs[i] ?? 0;
  if (t < 0) throw new Error(\`negative \${t}\`);
  scratch.n = t; return \`plain\`.length + t;
}`)).toEqual([]);
  // a tagged arrow (a const, a class property) and a nested tagged function are each their own scope
  expect(kinds(`/** @frame */ const tick = (n: number) => [n];
class D { /** @frame */ private readonly pass = (): void => { run(() => 1); }; }`)).toEqual(['array','closure']);
});

test('the tag is the comment right before the function, and scope is client and shared source',()=>{
  expect(frameTagged('/** a @frame b */\n  export function f() {}', 20)).toBe(true);
  expect(frameTagged('// @frame\nfunction f() {}', 10)).toBe(true);
  expect(frameTagged('/** @frameRate */\nfunction f() {}', 18)).toBe(false);
  expect(frameTagged('/** @frame */ x();\nfunction f() {}', 19)).toBe(false);
  expect(frameAllocPath('/x/engine/src/client/a.ts')).toBe('src/client/a.ts');
  expect(FRAME_ALLOC_SCOPE.test('src/server/game/x.ts')).toBe(false);
  expect(FRAME_ALLOC_SCOPE.test('src/client/game/x.test.ts')).toBe(false);
});

test('the committed debt covers the tree: no file has more sites than its allowance',()=>{
  const now=countFrameAllocDebt(),allowed:Record<string,number>=debt.files;
  expect(Object.entries(now).filter(([file,count])=>count>(allowed[file]??0))).toEqual([]);
});
