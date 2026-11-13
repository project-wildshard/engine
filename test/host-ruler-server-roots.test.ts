// HOST-RULER HR2: a built product's server roots, from the host ids its native-assembly.json declares.
import { describe, expect, test } from 'vitest';
import { unresolvedRoots } from '../scripts/host-ruler/roots.mjs';
import { NATIVE_ASSEMBLY_ROOT, nativeAssemblyRoots, productServerRoots, serverRootsFrom } from '../scripts/host-ruler/server-roots.mjs';

const table = nativeAssemblyRoots();
const hostRoots = (dir: string) => productServerRoots(`test/fixtures/host-ruler/${dir}`, table);
const ownModules = (roots: ReturnType<typeof hostRoots>) => new Set(roots.roots.filter(row => row.from !== NATIVE_ASSEMBLY_ROOT).map(row => row.module));

describe('nativeAssemblyHosts.ts read statically', () => {
  test('every case is attributed, every imported binding is reached, every root resolves', () => {
    expect(table.hosts.size).toBeGreaterThan(40);
    expect([...table.hosts].filter(([, entry]) => entry.unplaced.length > 0)).toEqual([]);
    expect(table.unattributed).toEqual([]);
    expect(unresolvedRoots([...table.hosts.values()].flatMap(entry => entry.roots))).toEqual([]);
    expect(unresolvedRoots(table.shared)).toEqual([]);
  });
  test('a case roots only the bindings its body uses, through helpers, never its types', () => {
    expect(table.hosts.get('water.sea')?.roots).toEqual([
      { module: 'src/server/game/shardfile/nativeAssemblyInput.ts', bindings: ['need'] },
      { module: 'src/shared/engine/world/water/declared.ts', bindings: ['declaredWaterBody'] },
      { module: 'src/shared/engine/world/waves.ts', bindings: ['waveHeight'] },
    ].sort((a, b) => a.module.localeCompare(b.module)));
    // riding.elites calls prepareRidingElites -> nativeEliteCore -> eliteDrops; installGroundBoss appears only in a type.
    const elites = table.hosts.get('riding.elites')?.roots.flatMap(row => row.bindings) ?? [];
    expect(elites).toEqual(expect.arrayContaining(['NativeEliteRoster', 'eliteDrops', 'EliteCore', 'pageStateOf', 'strikeFromData']));
    expect(elites).not.toContain('installGroundBoss');
    // nativeAssembly.ts reads the patrol's intake only when encounter.patrol is declared.
    expect(table.hosts.get('encounter.patrol')?.roots.flatMap(row => row.bindings)).toEqual(expect.arrayContaining(['readPatrolIntake', 'withEncounters']));
    expect(table.shared.flatMap(row => row.bindings)).not.toContain('readPatrolIntake');
    // The dispatcher is the table, never a shared user: following it would reach every host's imports.
    expect(table.shared.some(row => row.module === 'src/server/game/shardfile/nativeAssemblyHosts.ts')).toBe(false);
  });
  test('a case it cannot attribute, and a host id with no case, are unmeasured, never shared', () => {
    const source = `import { a } from './nativeAssemblyInput';\nimport { b } from './nativeRuntimeLoans';\n`
      + `export async function prepareAssemblyFeature(row, at) { switch (row.host) {\n`
      + `  case 'x.one': case 'x.two': return run => a(run);\n`
      + `  case 'x.mystery': return run => hidden(run);\n`
      + `  case 'x.shadow': { const b = 1; return run => a(b); }\n`
      + `  default: throw new Error('Unknown'); } }\n`;
    const fake = nativeAssemblyRoots({ hosts: { path: 'src/server/game/shardfile/nativeAssemblyHosts.ts', source } });
    expect(fake.hosts.get('x.one')).toEqual(fake.hosts.get('x.two'));
    expect(fake.hosts.get('x.one')?.unplaced).toEqual([]);
    const roots = serverRootsFrom({ slug: 'fake', hosts: ['x.one', 'x.mystery', 'x.shadow', 'x.nowhere'] }, fake);
    expect(roots.unmeasured.map(row => row.host)).toEqual(['x.mystery', 'x.shadow', 'x.nowhere']);
    expect(roots.unmeasured[0]?.reason).toContain('hidden');
    expect(roots.roots.filter(row => row.from !== NATIVE_ASSEMBLY_ROOT)).toEqual([{ from: 'host:x.one', module: 'src/server/game/shardfile/nativeAssemblyInput.ts', bindings: ['a'] }]);
  });
  test('code the reader cannot attribute refuses: import(), recursion, a fall-through to default', () => {
    const hosts = (body: string) => ({ path: 'src/server/game/shardfile/nativeAssemblyHosts.ts', source: `export async function prepareAssemblyFeature(row, at) { switch (row.host) {\n${body}\n} }\n` });
    expect(() => nativeAssemblyRoots({ hosts: hosts(`case 'x': return import('./nativeRuntimeLoans');`) })).toThrow('import()');
    expect(() => nativeAssemblyRoots({ hosts: { ...hosts(`case 'x': return f();`), source: `const f = () => f();\n${hosts(`case 'x': return f();`).source}` } })).toThrow('recursive');
    expect(() => nativeAssemblyRoots({ hosts: hosts(`case 'x': default: throw new Error('no');`) })).toThrow('fall through to default');
  });
});

describe('product server roots', () => {
  test('two fixture products declaring different host ids reach disjoint import sets', () => {
    const a = hostRoots('native-a'), b = hostRoots('native-b');
    expect([a.hosts, b.hosts]).toEqual([['day.toon'], ['grapple', 'decisions']]);
    const [own, other] = [ownModules(a), ownModules(b)];
    expect(own.size).toBeGreaterThan(0);
    expect(other.size).toBeGreaterThan(0);
    expect([...own].filter(module => other.has(module))).toEqual([]);
    expect(own.has('src/shared/engine/world/dayCycle.ts')).toBe(true);
    expect(other.has('src/server/game/grapple/native.ts')).toBe(true);
    // Both share only the @native-assembly root.
    expect(a.roots.filter(row => row.from === NATIVE_ASSEMBLY_ROOT)).toEqual(b.roots.filter(row => row.from === NATIVE_ASSEMBLY_ROOT));
  });
  test('a product without a native assembly reaches no server roots', () => {
    expect(hostRoots('fixture-product')).toMatchObject({ hosts: [], roots: [], unmeasured: [] });
  });
  test.each([['native-pine-hollow', 'pine-hollow', 17], ['native-driftwood-isle', 'driftwood-isle', 14]])('copied real product %s: every host id resolves', (dir, slug, hosts) => {
    const roots = hostRoots(dir);
    expect([roots.slug, roots.hosts.length]).toEqual([slug, hosts]);
    expect(roots.unmeasured).toEqual([]);
    for (const id of roots.hosts) expect(table.hosts.has(id)).toBe(true);
    expect(unresolvedRoots(roots.modules)).toEqual([]);
  });
});
