// oxlint-disable-next-line import/no-nodejs-modules -- Every write is confined to an owned fixture under ./tmp.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, relative, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real Node resolution from the frozen export.
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { linkNodeModules } from '../scripts/link-node-modules.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function scratch(): string {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = realpathSync(mkdtempSync(resolve('tmp', 'link-node-modules-')));
  roots.push(root);
  return root;
}

describe('linkNodeModules', () => {
  it('relinks a package dependency whose old store target is gone', () => {
    const root = scratch();
    const repo = join(root, 'repo'), tree = join(root, 'tree');
    const store = join(repo, 'node_modules', '.pnpm', 'valibot@1.6.0', 'node_modules', 'valibot');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'package.json'), '{"name":"valibot","version":"1.6.0"}');
    mkdirSync(join(repo, 'src', 'format', 'node_modules'), { recursive: true });
    for (const dir of [repo, tree]) {
      mkdirSync(join(dir, 'src', 'format'), { recursive: true });
      writeFileSync(join(dir, 'src', 'format', 'package.json'), '{"name":"@wildshard/format","dependencies":{"valibot":"1.6.0"}}');
    }
    // the tree already has a package node_modules whose valibot link points at a version since removed from the store
    mkdirSync(join(tree, 'node_modules'), { recursive: true });
    mkdirSync(join(tree, 'src', 'format', 'node_modules'), { recursive: true });
    symlinkSync(join(repo, 'node_modules', '.pnpm', 'valibot@1.5.0', 'node_modules', 'valibot'), join(tree, 'src', 'format', 'node_modules', 'valibot'));

    linkNodeModules(repo, tree);

    expect(readlinkSync(join(tree, 'src', 'format', 'node_modules', 'valibot'))).toBe(store);
  });

  it('relinks a missing dependency from the global virtual store when the install uses it (GVS G9)', () => {
    const root = scratch();
    const repo = join(root, 'repo'), tree = join(root, 'tree'), links = join(root, 'store', 'v10', 'links');
    const store = join(links, '@', 'valibot', '1.6.0', 'a1b2', 'node_modules', 'valibot');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'package.json'), '{"name":"valibot","version":"1.6.0"}');
    mkdirSync(join(repo, 'node_modules'), { recursive: true });
    // pnpm's metadata names the store's links/ as the virtual store; the checkout has no node_modules/.pnpm at all
    writeFileSync(join(repo, 'node_modules', '.modules.yaml'), JSON.stringify({ virtualStoreDir: relative(join(repo, 'node_modules'), links) }));
    mkdirSync(join(repo, 'src', 'format', 'node_modules'), { recursive: true });
    for (const dir of [repo, tree]) {
      mkdirSync(join(dir, 'src', 'format'), { recursive: true });
      writeFileSync(join(dir, 'src', 'format', 'package.json'), '{"name":"@wildshard/format","dependencies":{"valibot":"1.6.0"}}');
    }
    mkdirSync(join(tree, 'node_modules'), { recursive: true });
    mkdirSync(join(tree, 'src', 'format', 'node_modules'), { recursive: true });
    symlinkSync(join(links, '@', 'valibot', '1.5.0', 'c3d4', 'node_modules', 'valibot'), join(tree, 'src', 'format', 'node_modules', 'valibot'));

    linkNodeModules(repo, tree);

    expect(readlinkSync(join(tree, 'src', 'format', 'node_modules', 'valibot'))).toBe(store);
  });

  it('repoints a package that left the workspace when its folder survives without a manifest', () => {
    const root = scratch();
    const repo = join(root, 'repo'), tree = join(root, 'tree');
    const installed = join(repo, 'node_modules', '.pnpm', 'format@git', 'node_modules', '@wildshard', 'format');
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, 'package.json'), '{"name":"@wildshard/format"}');
    mkdirSync(join(repo, 'node_modules', '@wildshard'), { recursive: true });
    symlinkSync('../.pnpm/format@git/node_modules/@wildshard/format', join(repo, 'node_modules', '@wildshard', 'format'));
    // the slot's link predates the move, and git left the ignored node_modules behind in src/format
    mkdirSync(join(tree, 'node_modules', '@wildshard'), { recursive: true });
    mkdirSync(join(tree, 'src', 'format', 'node_modules'), { recursive: true });
    symlinkSync('../../src/format', join(tree, 'node_modules', '@wildshard', 'format'));
    // a package's own links: the checkout's sdk has the install, its commons resolves from the root
    mkdirSync(join(repo, 'src', 'sdk', 'node_modules', '@wildshard'), { recursive: true });
    symlinkSync(join(repo, 'node_modules', '@wildshard', 'format'), join(repo, 'src', 'sdk', 'node_modules', '@wildshard', 'format'));
    mkdirSync(join(repo, 'src', 'commons', 'node_modules'), { recursive: true });
    for (const pkg of ['sdk', 'commons']) {
      mkdirSync(join(tree, 'src', pkg, 'node_modules', '@wildshard'), { recursive: true });
      symlinkSync('../../../format', join(tree, 'src', pkg, 'node_modules', '@wildshard', 'format'));
    }

    linkNodeModules(repo, tree);

    expect(realpathSync(join(tree, 'node_modules', '@wildshard', 'format'))).toBe(installed);
    expect(realpathSync(join(tree, 'src', 'sdk', 'node_modules', '@wildshard', 'format'))).toBe(installed);
    expect(existsSync(join(tree, 'src', 'commons', 'node_modules', '@wildshard', 'format'))).toBe(false);
  });

  it('moves a reused slot to the installed release of a package', () => {
    const root = scratch();
    const repo = join(root, 'repo'), tree = join(root, 'tree');
    const release = (version: string): string => {
      const folder = join(repo, 'node_modules', '.pnpm', `format@${version}`, 'node_modules', '@wildshard', 'format');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'package.json'), `{"name":"@wildshard/format","version":"${version}"}`);
      return folder;
    };
    const older = release('0.3.0'), current = release('0.3.1');
    mkdirSync(join(repo, 'node_modules', '@wildshard'), { recursive: true });
    symlinkSync('../.pnpm/format@0.3.1/node_modules/@wildshard/format', join(repo, 'node_modules', '@wildshard', 'format'));
    mkdirSync(join(tree, 'node_modules', '@wildshard'), { recursive: true });
    symlinkSync(older, join(tree, 'node_modules', '@wildshard', 'format'));

    linkNodeModules(repo, tree);

    expect(realpathSync(join(tree, 'node_modules', '@wildshard', 'format'))).toBe(current);
  });

  it('imports a registered shared-store dependency from a cold frozen export', () => {
    const root = scratch(), repo = join(root, 'repo'), tree = join(root, 'exports', 'tree'), store = join(root, 'store');
    const installed = join(store, 'format-content'), outside = join(root, 'live-format'), provider = join(store, 'provider');
    mkdirSync(provider, { recursive: true });
    writeFileSync(join(provider, 'package.json'), '{"name":"shared-provider","type":"module","exports":"./index.mjs"}');
    writeFileSync(join(provider, 'index.mjs'), 'export default {};');
    for (const directory of [installed, outside]) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@wildshard/format', type: 'module', exports: './index.mjs' }));
      writeFileSync(join(directory, 'index.mjs'), `export default ${JSON.stringify(directory === installed ? 'installed-format' : 'unregistered-source')};`);
    }
    mkdirSync(join(installed, 'node_modules'));
    symlinkSync(provider, join(installed, 'node_modules', 'shared-provider'));
    writeFileSync(join(installed, 'index.mjs'), "export default 'installed-format'; export {default as shared} from 'shared-provider';");
    for (const directory of [repo, tree]) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@wildshard/engine', type: 'module', exports: './index.mjs' }));
      writeFileSync(join(directory, 'index.mjs'), `export default ${JSON.stringify(directory === tree ? 'frozen-export' : 'dirty-checkout')}; export {shared} from '@wildshard/format';`);
    }
    mkdirSync(join(repo, 'node_modules', '@wildshard'), { recursive: true });
    // Preserve actual pinned-pnpm metadata fields; substitute only this fixture's store location.
    const installedMetadata: Record<string, unknown> = JSON.parse(readFileSync(resolve('node_modules/.modules.yaml'), 'utf8'));
    installedMetadata['virtualStoreDir'] = relative(join(repo, 'node_modules'), store);
    writeFileSync(join(repo, 'node_modules', '.modules.yaml'), JSON.stringify(installedMetadata));
    symlinkSync('../..', join(repo, 'node_modules', '@wildshard', 'engine'));
    const link = join(repo, 'node_modules', '@wildshard', 'format');
    symlinkSync(installed, link);
    mkdirSync(join(tree, 'consumer'));
    writeFileSync(join(tree, 'consumer', 'package.json'), '{"name":"proof-consumer","type":"commonjs"}');

    linkNodeModules(repo, tree);

    const load = createRequire(join(tree, 'consumer', 'entry.cjs'));
    // Node's own loader consumes both modules: frozen source plus the installed dependency.
    const engine: Record<string, unknown> = load('@wildshard/engine'), format: Record<string, unknown> = load('@wildshard/format');
    expect(engine).toMatchObject({ default: 'frozen-export' });
    expect(format).toMatchObject({ default: 'installed-format' });
    expect(engine['shared']).toBe(format['shared']);
    linkNodeModules(repo, tree);
    expect(realpathSync(join(tree, 'node_modules', '@wildshard', 'engine'))).toBe(tree);
    const nested = join(root, 'nested', 'deeper', 'export');
    mkdirSync(join(nested, 'consumer'), { recursive: true });
    writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: '@wildshard/engine', type: 'module', exports: './index.mjs' }));
    writeFileSync(join(nested, 'index.mjs'), "export default 'nested-export'; export {shared} from '@wildshard/format';");
    writeFileSync(join(nested, 'consumer', 'package.json'), '{"name":"nested-consumer","type":"commonjs"}');
    linkNodeModules(tree, nested);
    const nestedLoad = createRequire(join(nested, 'consumer', 'entry.cjs'));
    const nestedEngine: Record<string, unknown> = nestedLoad('@wildshard/engine');
    expect(nestedEngine).toMatchObject({ default: 'nested-export' });
    expect(nestedLoad('@wildshard/format')).toBe(format);
    expect(nestedEngine['shared']).toBe(format['shared']);
    for (const scalar of [String(installedMetadata['virtualStoreDir']), JSON.stringify(installedMetadata['virtualStoreDir']), `'${String(installedMetadata['virtualStoreDir'])}'`]) {
      writeFileSync(join(repo, 'node_modules', '.modules.yaml'), `virtualStoreDir: ${scalar}\nlayoutVersion: 5\n`);
      const yamlTree = join(root, `yaml-${scalar.length}`); mkdirSync(yamlTree, {recursive: true});
      linkNodeModules(repo, yamlTree);
      expect(realpathSync(join(yamlTree, 'node_modules', '@wildshard', 'format'))).toBe(installed);
    }
    writeFileSync(join(repo, 'node_modules', '.modules.yaml'), JSON.stringify(installedMetadata));

    unlinkSync(link); symlinkSync(outside, link);
    const unregistered = join(root, 'unregistered'); mkdirSync(unregistered);
    expect(() => linkNodeModules(repo, unregistered)).toThrow();
    expect(() => linkNodeModules(repo, unregistered)).toThrow();
    unlinkSync(link);
    mkdirSync(join(repo, 'node_modules', '.pnpm'));
    symlinkSync(outside, join(repo, 'node_modules', '.pnpm', 'lexical-alias'));
    symlinkSync(join(repo, 'node_modules', '.pnpm', 'lexical-alias'), link);
    const lexical = join(root, 'lexical'); mkdirSync(lexical);
    expect(() => linkNodeModules(repo, lexical)).toThrow();
    expect(() => linkNodeModules(repo, lexical)).toThrow();
    unlinkSync(link); symlinkSync(outside, join(store, 'escape')); symlinkSync(join(store, 'escape'), link);
    const escaped = join(root, 'escaped'); mkdirSync(escaped);
    expect(() => linkNodeModules(repo, escaped)).toThrow();
    expect(() => linkNodeModules(repo, escaped)).toThrow();
    unlinkSync(link); symlinkSync(installed, link);
    writeFileSync(join(repo, 'node_modules', '.modules.yaml'), '{');
    const corrupt = join(root, 'corrupt'); mkdirSync(corrupt);
    expect(() => linkNodeModules(repo, corrupt)).toThrow();
    expect(() => linkNodeModules(repo, corrupt)).toThrow();
    writeFileSync(join(repo, 'node_modules', '.modules.yaml'), JSON.stringify({ virtualStoreDir: relative(join(repo, 'node_modules'), store) }));
    writeFileSync(join(installed, 'package.json'), '{"name":"unrelated-package"}');
    const crossed = join(root, 'crossed'); mkdirSync(crossed);
    expect(() => linkNodeModules(repo, crossed)).toThrow();
    expect(() => linkNodeModules(repo, crossed)).toThrow();
    writeFileSync(join(installed, 'package.json'), '{"name":"@wildshard/format"}');
    for (const directory of [repo, tree]) {
      mkdirSync(join(directory, 'src', 'sdk'), {recursive: true});
      writeFileSync(join(directory, 'src', 'sdk', 'package.json'), '{"name":"@wildshard/sdk"}');
    }
    mkdirSync(join(repo, 'src', 'sdk', 'node_modules', '@wildshard'), {recursive: true});
    symlinkSync(outside, join(repo, 'src', 'sdk', 'node_modules', '@wildshard', 'format'));
    expect(() => linkNodeModules(repo, tree)).toThrow();
    expect(() => linkNodeModules(repo, tree)).toThrow();
  });

  it('links an aliased dependency from the global store only when the checkout declares that alias (GVS G9)', () => {
    const root = scratch();
    const repo = join(root, 'repo'), links = join(root, 'store', 'v10', 'links');
    // `@wildshard/wire-released` is a github alias: its store slot holds the package under its real name.
    const slot = join(links, '@wildshard', 'wire', '0.0.0', 'e5f6', 'node_modules', '@wildshard', 'wire');
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, 'package.json'), '{"name":"@wildshard/wire","version":"0.0.0"}');
    mkdirSync(join(repo, 'node_modules', '@wildshard'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', '.modules.yaml'), JSON.stringify({ virtualStoreDir: relative(join(repo, 'node_modules'), links) }));
    symlinkSync(slot, join(repo, 'node_modules', '@wildshard', 'wire-released'));
    const manifest = (spec: string | undefined) => writeFileSync(join(repo, 'package.json'), JSON.stringify(
      { name: '@wildshard/engine', devDependencies: spec === undefined ? {} : { '@wildshard/wire-released': spec } }));

    manifest('github:project-wildshard/shardfile#669d1fc&path:/packages/wire');
    const declared = join(root, 'declared'); mkdirSync(declared);
    linkNodeModules(repo, declared);
    expect(realpathSync(join(declared, 'node_modules', '@wildshard', 'wire-released'))).toBe(slot);

    manifest('npm:@wildshard/wire@0.0.0');
    const npm = join(root, 'npm'); mkdirSync(npm);
    linkNodeModules(repo, npm);
    expect(realpathSync(join(npm, 'node_modules', '@wildshard', 'wire-released'))).toBe(slot);

    // Not declared, a registry range, or an npm alias naming another package: the slot is not this name's.
    for (const spec of [undefined, '0.0.0', 'npm:@wildshard/other@0.0.0']) {
      manifest(spec);
      const refused = join(root, `refused-${String(spec).length}`); mkdirSync(refused);
      expect(() => linkNodeModules(repo, refused)).toThrow(/points outside the repo/u);
    }
  });
});
