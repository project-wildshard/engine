// oxlint-disable-next-line import/no-nodejs-modules -- Every write is confined to an owned fixture under ./tmp.
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
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
});
