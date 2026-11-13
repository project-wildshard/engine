// HOST-RULER HR3 (meta docs/plans/HOST-RULER-PLAN.md): a product's closure, and the modules only it reaches.
// oxlint-disable-next-line import/no-nodejs-modules -- Runs the ruler's CLI as a user would.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { applyRegister, codeLines, createTreeReader, formatInventory, formatTable, inventory, layerOf, OPTIONS, optionCharges, shardTotals, measure, oneUserLines, productRootModules, reach, rule, SHELL, SHELL_CONTROL, SHELL_ROOTS, TABLES } from '../scripts/host-ruler.mjs';
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

describe('the shell by name, format charged (HR4, HA0 d, e)', () => {
  const tree = createTreeReader({ root: 'test/fixtures/host-ruler/tree', formatDir: 'test/fixtures/host-ruler/tree/format' });
  const products = [{ slug: 'a', roots: ['src/client/game/feature/a.ts'] }, { slug: 'b', roots: ['src/client/game/feature/b.ts'] }];
  const shell = { roots: ['src/client/app/entry.ts'], control: ['src/client/game/session/play.ts'] };
  const modules = measure(products, tree, { shell });

  test('a one-user module under session/ is charged, though the shell reaches it; a named control module is not', () => {
    expect(reach(shell.roots, tree).has('src/client/game/session/hudExtra.ts')).toBe(true);
    expect(modules.get('src/client/game/session/hudExtra.ts')?.users).toEqual(['a']);
    expect(modules.get('src/client/game/session/play.ts')?.users).toEqual([SHELL, 'a', 'b']);
  });
  test('format imports resolve through the pinned package\'s exports map and a one-user schema is charged under format', () => {
    expect(modules.get('@wildshard/format/src/format/oneUser.ts')).toEqual({ lines: 5, layer: 'format', users: ['a'] });
    // Its relative import inside the package resolves to the same package id.
    expect(modules.get('@wildshard/format/src/format/shared.ts')?.users).toEqual(['a', 'b']);
    const lines = oneUserLines(modules, ['a', 'b']);
    expect(lines.get('a')).toEqual({ modules: 3, lines: 4 + 4 + 5, format: 5 });
    expect(lines.get('b')).toEqual({ modules: 1, lines: 3, format: 0 });
  });
  test('a format file the package does not publish refuses; HR3\'s reading stops at format', () => {
    expect(() => tree.read('src/client/game/feature/leak.ts')).toThrow(/is not a published file of @wildshard\/format/u);
    expect([...reach(['src/client/game/feature/a.ts'], createTreeReader({ root: 'test/fixtures/host-ruler/tree', formatDir: 'test/fixtures/host-ruler/tree/format', format: false }))].sort())
      .toEqual(['src/client/game/feature/a.ts', 'src/client/game/session/hudExtra.ts', 'src/client/game/session/play.ts']);
  });
  test('the real pinned format package: its published files are what the ruler follows', () => {
    expect(reader.format.published('src/format/stealth.ts')).toBe(true);
    expect(reader.format.published('src/format/stealth.test.ts')).toBe(false);
    const stealth = reader.read('@wildshard/format/src/format/stealth.ts');
    expect(stealth.lines).toBeGreaterThan(0);
    expect(stealth.imports.every(module => !module.startsWith('node_modules/'))).toBe(true);
    expect(layerOf('@wildshard/format/src/format/stealth.ts')).toBe('format');
  });
  test('every named shell control module exists and the app entry reaches it', () => {
    const shellReach = reach(SHELL_ROOTS, reader);
    expect(SHELL_CONTROL.filter(module => !shellReach.has(module))).toEqual([]);
    expect(new Set(SHELL_CONTROL).size).toBe(SHELL_CONTROL.length);
  });
});

describe('the platform rule and the register\'s gates (HR6, HA0 f)', () => {
  const tree = createTreeReader({ root: 'test/fixtures/host-ruler/tree', formatDir: 'test/fixtures/host-ruler/tree/format' });
  const products = [{ slug: 'a', roots: ['src/client/game/feature/a.ts'] }, { slug: 'b', roots: ['src/client/game/feature/b.ts'] }];
  const modules = measure(products, tree, { shell: { roots: ['src/client/app/entry.ts'], control: ['src/client/game/session/play.ts'] } });
  const today = '2026-11-13';
  const row = (key: string, verdict: string, extra: Record<string, unknown> = {}) => ({ key, verdict, decision: 'G600', users: [], ...extra });
  const register = [
    row('src/client/game/session/hudExtra.ts', 'game'),
    row('@wildshard/format/src/format/oneUser.ts', 'pending', { recheck: '2026-11-01' }),
    row('@wildshard/format/src/format/oneUser.ts#readOneUser', 'pending', { recheck: '2026-12-11' }),
    row('@wildshard/format/src/format/shared.ts', 'silly', { users: ['b'] }),
  ];
  const ruled = applyRegister(modules, tree, register, { today });
  const spans = (module: string) => Object.fromEntries(Object.entries(ruled.modules.get(module)!.spans).filter(([, lines]) => lines > 0));

  test('two or more real users: platform, with or without a row', () => {
    expect(ruled.modules.has('src/client/game/session/play.ts')).toBe(false);
    expect(ruled.modules.has('@wildshard/format/src/format/shared.ts')).toBe(false);
  });
  test('one user and an engine/game row with a decision: platform', () => {
    expect(spans('src/client/game/session/hudExtra.ts')).toEqual({ platform: 4 });
  });
  test('one user and no row: charged, printed as one-user host, no register row', () => {
    expect(spans('src/client/game/feature/a.ts')).toEqual({ 'no-row': 4 });
    const report = { products: [], format: '0.0.0', today, modules, ruled, options: [], oneUser: oneUserLines(modules, ['a', 'b']), totals: shardTotals(ruled, ['a', 'b']) };
    expect(formatTable(report)).toContain('one-user host, no register row: a src/client/game/feature/a.ts (4 lines)');
  });
  test('a pending row past recheck charges back; a binding row before recheck stays credited', () => {
    // readOneUser (3 lines) is pending to 2026-12-11; the rest of the module is pending to 2026-11-01, so past.
    expect(spans('@wildshard/format/src/format/oneUser.ts')).toEqual({ pending: 3, 'charged-back': 2 });
    // Before either recheck, the whole module is credited.
    expect(applyRegister(modules, tree, register, { today: '2026-10-01' }).modules.get('@wildshard/format/src/format/oneUser.ts')!.spans.pending).toBe(5);
  });
  test('a silly row on a shared module charges its lines to the row\'s users; totals add up', () => {
    expect(ruled.sillyShared).toEqual([{ module: '@wildshard/format/src/format/shared.ts', users: ['b'], lines: 1, key: '@wildshard/format/src/format/shared.ts' }]);
    const totals = shardTotals(ruled, ['a', 'b']);
    expect(totals.get('a')).toEqual({ modules: 3, lines: 13, format: 5, platform: 4, pending: 3, 'no-row': 4, 'charged-back': 2, silly: 0, option: 0, charged: 6 });
    expect(totals.get('b')).toEqual({ modules: 1, lines: 3, format: 0, platform: 0, pending: 0, 'no-row': 3, 'charged-back': 0, silly: 1, option: 0, charged: 4 });
  });
  test('a platform verdict without a decision id refuses', () => {
    expect(() => applyRegister(modules, tree, [{ key: 'src/client/game/feature/a.ts', verdict: 'engine', users: [] }], { today })).toThrow(/without a decision id/u);
    expect(() => applyRegister(modules, tree, [{ key: 'src/client/game/feature/a.ts', verdict: 'game', decision: '', users: [] }], { today })).toThrow(/without a decision id/u);
  });
  test('the real register reads and every product run prints both readings', () => {
    const report = rule(['test/fixtures/host-ruler/closure-a', 'test/fixtures/host-ruler/pine-hollow'], { today });
    expect(report.totals.get('pine-hollow')!.lines).toBe(report.oneUser.get('pine-hollow')!.lines);
    expect(formatTable(report)).toMatch(/\| pine-hollow +\|/u);
  });
});

describe('optional sub-rows (HR7, HA0 c)', () => {
  const c = productRootModules('test/fixtures/host-ruler/option-c', { plan });
  const d = productRootModules('test/fixtures/host-ruler/option-d', { plan });
  const modules = measure([c, d], reader);
  const charges = optionCharges(modules, [c, d], reader);

  test('two products declare species.program; the one setting catalogue alone is charged its binding', () => {
    expect(modules.get('src/client/game/shardfile/clientSpeciesProgram.ts')?.users).toEqual(['option-c', 'option-d']);
    expect(c.options).toEqual(['species.program.catalogue', 'quest.composition.figures']);
    expect(charges).toEqual([{ key: 'src/client/game/shardfile/clientSpeciesProgram.ts#prepareClientSpeciesCatalogue', user: 'option-c', option: 'species.program.catalogue', lines: expect.any(Number) }]);
    expect(charges[0]!.lines).toBeGreaterThan(5);
    const totals = shardTotals(applyRegister(modules, reader, [], { today: '2026-11-13' }), ['option-c', 'option-d'], charges);
    expect(totals.get('option-c')!.option).toBe(charges[0]!.lines);
    expect(totals.get('option-d')!.option).toBe(0);
  });
  test('a branch\'s imports are held back for a product without the option', () => {
    expect([...d.held].map(edge => edge.split('\0')[1])).toContain('src/client/game/quest/figures.ts');
    expect(c.held.size).toBe(0);
    // A held edge cuts only that import: figures.ts is still shared through other paths today.
    const tree = createTreeReader({ root: 'test/fixtures/host-ruler/tree', formatDir: 'test/fixtures/host-ruler/tree/format' });
    const edge = new Set(['src/client/game/feature/a.ts\0src/client/game/session/hudExtra.ts']);
    expect(reach(['src/client/game/feature/a.ts'], tree, TABLES, edge).has('src/client/game/session/hudExtra.ts')).toBe(false);
    expect(reach(['src/client/game/feature/a.ts'], tree, TABLES).has('src/client/game/session/hudExtra.ts')).toBe(true);
  });
  test('an option row\'s kind binding roots nothing without its option: debug.expose without a dressing source', () => {
    expect(d.roots).not.toContain('src/client/game/shardfile/sceneDressing.ts');
  });
  test('every option the table does not name prints as unmeasured, never free', () => {
    expect(d.unmeasuredOptions).toEqual(['debug.expose.name', 'quest.composition.file', 'quest.composition.id']);
    const report = rule(['test/fixtures/host-ruler/option-c', 'test/fixtures/host-ruler/option-d'], { today: '2026-11-13', register: [] });
    const out = formatTable(report);
    expect(out).toContain('unmeasured option: quest.composition.file (option-c, option-d)');
    expect(out).toContain('option-charged: option-c src/client/game/shardfile/clientSpeciesProgram.ts#prepareClientSpeciesCatalogue');
  });
  test('each option binding is used only by its option', () => {
    const source = (path: string) => readFileSync(path, 'utf8');
    for (const entry of OPTIONS) for (const key of entry.bindings) {
      const [module, binding] = key.split('#') as [string, string];
      expect(reader.read(module).declarations.some(row => row.names.includes(binding)), key).toBe(true);
      const where = entry.from ?? CLIENT_PLAN;
      // A branch import is named twice in `from`: its import and its one use. A kind binding is named by clientPlan.ts.
      const count = source(where).split(new RegExp(String.raw`\b${binding}\b`, 'u')).length - 1;
      if (entry.from === undefined) expect(count, key).toBeGreaterThan(0);
      else expect(count, key).toBe(2);
    }
  });
});

describe('the inventory (HR8, HA1)', () => {
  const report = rule(['test/fixtures/host-ruler/closure-a', 'test/fixtures/host-ruler/pine-hollow'], { today: '2026-11-13' });
  const rows = inventory(report, { sharddev: 'test/fixtures/host-ruler/tree' });
  const byModule = new Map(rows.map(row => [row.module, row]));

  test('every engine layer module, every published format module and the sdk, once each', () => {
    expect(new Set(rows.map(row => row.module)).size).toBe(rows.length);
    expect(rows.filter(row => row.layer === 'format').every(row => reader.format.published(row.module.slice('@wildshard/format/'.length)))).toBe(true);
    expect(rows.some(row => row.module.endsWith('.test.ts'))).toBe(false);
    expect(byModule.get('sharddev/src/sharddev/bake/run.ts')).toEqual({ module: 'sharddev/src/sharddev/bake/run.ts', layer: 'sdk', lines: 1, users: ['build-time'], register: '-', entry: 'none' });
    expect(rows.filter(row => row.layer.endsWith('/engine')).length).toBeGreaterThan(500);
    // Every TypeScript module a product reaches is in the inventory with the same users (data files count no lines).
    for (const [module, use] of report.modules) if (/\.tsx?$/u.test(module)) expect(byModule.get(module)?.users, module).toEqual(use.users);
  });
  test('it names the entry table, the register row and the users', () => {
    expect(byModule.get('src/client/game/shardfile/clientMeadow.ts')).toMatchObject({ users: ['closure-a'], entry: 'kind world.meadow' });
    expect(byModule.get('src/client/game/shardfile/worldScenes.ts')?.entry).toContain('section world/scenes');
    expect(byModule.get('src/client/game/shardfile/clientForestPage.ts')?.register).toBe('pending G571');
    expect(byModule.get('src/server/game/shardfile/nativeAssemblyHosts.ts')?.entry).toBe('none');
    expect(formatInventory(rows.slice(0, 2)).split('\n')).toHaveLength(4);
  });
});
