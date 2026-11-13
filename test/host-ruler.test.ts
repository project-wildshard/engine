// HOST-RULER HR3 (meta docs/plans/HOST-RULER-PLAN.md): a product's closure, and the modules only it reaches.
// oxlint-disable-next-line import/no-nodejs-modules -- Runs the ruler's CLI as a user would.
import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { codeLines, createTreeReader, formatTable, measure, oneUserLines, productRootModules, reach, rule, TABLES } from '../scripts/host-ruler.mjs';
import { CLIENT_PLAN, clientPlanRoots } from '../scripts/host-ruler/roots.mjs';
import { NATIVE_ASSEMBLY, NATIVE_HOSTS } from '../scripts/host-ruler/server-roots.mjs';

const reader = createTreeReader();
const plan = clientPlanRoots();
const kindModules = (kind: string) => plan.kinds.get(kind)!.map(row => row.module);

describe('lines and edges', () => {
  test('code lines drop comments and blank lines, keep comment-like text in strings', () => {
    expect(codeLines('// a\nconst a = 1; /* b */\n\n/*\n c\n*/\nconst b = "// not a comment";\n')).toBe(2);
  });
  test('engine self-imports resolve through the exports map; type-only imports are no edge', () => {
    const row = reader.read('src/client/game/models/explorerCatalogue.ts');
    expect(row.imports).toContain('src/client/engine/core/tier.ts');
    // `import type { ExplorerEntryRow } from '@wildshard/format/explorerCatalogue'` only.
    expect(row.imports).not.toContain('@wildshard/format/src/format/explorerCatalogue.ts');
    expect(row.imports.every(module => module.startsWith('src/') || module.startsWith('@wildshard/format/') || module.startsWith('npm:'))).toBe(true);
  });
});

describe('tables are not users (HA0 a, b)', () => {
  test('entering a dispatch table follows none of its held-back imports', () => {
    const fromPlan = reach([CLIENT_PLAN], reader);
    // CLIENT_FEATURES' import() targets: no kind's own module is reached through the table.
    for (const kind of ['world.meadow', 'world.forest-page', 'fx.trail']) for (const module of kindModules(kind)) expect(fromPlan.has(module), `${kind} ${module}`).toBe(false);
    expect([...reach([NATIVE_HOSTS], reader)]).toEqual([NATIVE_HOSTS]);
    expect([...reach([NATIVE_ASSEMBLY], reader)]).toEqual([NATIVE_ASSEMBLY]);
    // Without the table rule the same walk takes in every kind: the fan-in HA0 (b) removes.
    const open = reach([CLIENT_PLAN], reader, {});
    expect(kindModules('world.meadow').every(module => open.has(module))).toBe(true);
  });
  test('every table is a real module of this tree', () => {
    for (const module of Object.keys(TABLES)) expect(reader.read(module).lines).toBeGreaterThan(0);
  });
});

describe('a product is charged exactly its declared kind', () => {
  const a = productRootModules('test/fixtures/host-ruler/closure-a', { plan });
  const b = productRootModules('test/fixtures/host-ruler/closure-b', { plan });
  const modules = measure([a, b], reader);
  const only = (slug: string) => [...modules].filter(([, row]) => row.users.length === 1 && row.users[0] === slug).map(([module]) => module).sort();

  test('two made-up products: one declaring world.meadow, one world.forest-page', () => {
    expect([a.slug, b.slug]).toEqual(['closure-a', 'closure-b']);
    expect(a.roots).toContain(CLIENT_PLAN);
    expect(a.roots).toContain('src/client/game/shardfile/clientMeadow.ts');
    expect(a.roots).not.toContain('src/client/game/shardfile/clientForestPage.ts');
  });
  test('the one-user modules of each product are its kind\'s closure, minus what the other product reaches', () => {
    const shared = reach([...plan.shared.filter(row => !row.typeOnly).map(row => row.module), CLIENT_PLAN], reader);
    const kindOnly = (kind: string, other: Set<string>) => [...reach(kindModules(kind), reader)].filter(module => !shared.has(module) && !other.has(module)).sort();
    const reachA = reach(a.roots, reader), reachB = reach(b.roots, reader);
    expect(only('closure-a')).toEqual(kindOnly('world.meadow', reachB));
    expect(only('closure-b')).toEqual(kindOnly('world.forest-page', reachA));
    expect(only('closure-a')).toContain('src/client/game/shardfile/clientMeadow.ts');
    expect(only('closure-b')).toContain('src/client/game/shardfile/clientForestPage.ts');
    // A kind neither declares is charged to nobody.
    for (const module of kindModules('fx.trail')) expect(modules.has(module)).toBe(false);
    const lines = oneUserLines(modules, ['closure-a', 'closure-b']);
    expect(lines.get('closure-a')!.lines).toBe(only('closure-a').reduce((sum, module) => sum + modules.get(module)!.lines, 0));
    expect(lines.get('closure-a')!.lines).toBeGreaterThan(0);
  });
  test('the CLI prints a per-shard one-user-lines table', () => {
    const out = execFileSync(process.execPath, ['scripts/host-ruler.mjs', '--products', 'test/fixtures/host-ruler/closure-a', 'test/fixtures/host-ruler/closure-b'], { encoding: 'utf8' });
    const report = rule(['test/fixtures/host-ruler/closure-a', 'test/fixtures/host-ruler/closure-b']);
    expect(out.trim()).toBe(formatTable(report));
    expect(out).toMatch(new RegExp(String.raw`\| closure-a +\| +${only('closure-a').length} \| +${report.oneUser.get('closure-a')!.lines} \|`, 'u'));
  });
});
