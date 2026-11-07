import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';

test('a world normal first read inside a branch is defined again where a read outside the branch uses it', () => {
  // D204: Nine's kit read the normal first in its leaf kind's branch; three's normalWorldGeometry is a `toVar`, so its
  // assignment stayed in that branch and the wash's lit term outside it read zero (the stone shaded as unlit). The
  // classic emitter builds a value again in the block that reads it, never out of another block.
  const noise = (from: string, k: number): Record<string, { op: string; in: (string | number | number[])[] }> => ({
    [`s${k}`]: { op: 'mul', in: [from, k + 1.5] }, [`n${k}`]: { op: 'noise', in: [`s${k}`] } });
  const leaf = { ...noise('nw', 0), ...noise('nw', 1), ...noise('nw', 2), ...noise('nw', 3), ...noise('nw', 4), ...noise('nw', 5) };
  const compiled = compileClassicGraph({ version: 1, kind: 'material', model: 'unlit', nodes: {
    kind: { op: 'attribute', name: 'aKind', type: 'float' }, isLeaf: { op: 'gt', in: ['kind', 0.5] },
    nw: { op: 'normalWorld' }, ...leaf,
    a01: { op: 'add', in: ['n0', 'n1'] }, a23: { op: 'add', in: ['n2', 'n3'] }, a45: { op: 'add', in: ['n4', 'n5'] },
    a0123: { op: 'add', in: ['a01', 'a23'] }, costly: { op: 'add', in: ['a0123', 'a45'] },
    pick: { op: 'select', in: ['isLeaf', 'costly', 0] },
    lit: { op: 'dot', in: ['nw', [0.35, 0.86, 0.38]] }, sum: { op: 'add', in: ['pick', 'lit'] },
    colour: { op: 'combine', in: ['sum', 'sum', 'sum'] } }, stages: { surface: { colour: 'colour' } }, effectState: { fog: false } });
  try {
    const shader = compiled.material.fragmentShader, main = shader.slice(shader.indexOf('void main()'));
    expect(compiled.selects.branch).toBe(1);
    const branch = main.search(/\bif \(/u);
    expect(branch).toBeGreaterThan(-1);
    const read = /dot\((t\d+_nw),/u.exec(main), name = read?.[1];
    if (read === null || name === undefined) throw new Error('Missing the lit term\'s normal read');
    const defined = main.lastIndexOf(`vec3 ${name} = `, read.index);
    expect(defined).toBeGreaterThan(branch);
    // the lit term's normal is defined at main's own depth: outside every branch
    const depth = (at: number): number => (main.slice(0, at).match(/\{/gu)?.length ?? 0) - (main.slice(0, at).match(/\}/gu)?.length ?? 0);
    expect(depth(defined)).toBe(1);
    expect(depth(read.index)).toBe(1);
  } finally { compiled.material.dispose(); }
});
