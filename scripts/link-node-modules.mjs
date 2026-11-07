#!/usr/bin/env node
// E432: give a clean export of the repo (a `git archive` tree) the checkout's node_modules — every entry linked back to
// the checkout's, except the workspace packages (@wildshard/engine, game, sdk, commons), which link to the export's own
// src/<layer>. @wildshard/format is installed from the shardfile repo, so it links like any other dependency, unless the
// export predates that and still holds its own src/format. A plain `ln -s <repo>/node_modules <tree>/node_modules` would resolve @wildshard/* through the checkout's
// links to the checkout's working tree, so the export would build (and gate) whatever is uncommitted there.
//
//   node scripts/link-node-modules.mjs <repo> <tree>          (the shell scripts)
//   import { linkNodeModules } from './link-node-modules.mjs'  (the node ones)
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * true when `path` holds a live entry; a dangling symlink (its target gone after a dependency update) is removed so the
 * caller can relink it, since existsSync follows links and symlinkSync refuses an existing name (EEXIST)
 * @param {string} path
 */
function present(path) {
  if (existsSync(path)) return true;
  try { if (lstatSync(path).isSymbolicLink()) unlinkSync(path); } catch { /* nothing there */ }
  return false;
}

/** the scopes whose packages live in the repo itself (pnpm-workspace.yaml) */
const WORKSPACE_SCOPES = new Set(['@wildshard']);

/**
 * link `<tree>/node_modules` to `<repo>/node_modules`, the workspace packages to the tree's own sources
 * @param {string} repo the checkout whose node_modules is installed
 * @param {string} tree the export (a git archive of some commit)
 */
export function linkNodeModules(repo, tree) {
  if (realpathSync(tree) !== resolve(tree)) {
    // macOS /tmp and /var are symlinks: a package resolved through node_modules (realpath) and a relative import (as
    // spelled) would load the same engine file twice. Export to the canonical path (`pwd -P`, realpathSync).
    throw new Error(`link-node-modules: ${tree} is not its canonical path (${realpathSync(tree)})`);
  }
  const from = resolve(repo, 'node_modules'), to = resolve(tree, 'node_modules');
  if (!existsSync(from)) return; // nothing installed (a test's throwaway repo): the tree resolves no packages, as before
  if (existsSync(to)) {
    if (lstatSync(to).isSymbolicLink()) throw new Error(`link-node-modules: ${to} is a whole-folder link; remove it first`);
    dropStaleScopeLinks(to);
    linkWorkspaceSources(tree, to);
    linkInstalledScope(repo, tree, from, to);
    linkPackageNodeModules(repo, tree);
    return; // existing links stay untouched; new manifest dependencies can still be repaired
  }
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (!WORKSPACE_SCOPES.has(name)) { symlinkSync(join(from, name), join(to, name)); continue; }
    mkdirSync(join(to, name));
    for (const pkg of readdirSync(join(from, name))) {
      if (existsSync(resolve(tree, 'src', pkg, 'package.json'))) continue; // linkWorkspaceSources names the tree's own
      const link = join(from, name, pkg);
      // the checkout's link points into the checkout (../../src/engine); the export's points at the same path in the tree
      const target = resolve(dirname(link), readlinkSync(link));
      const inRepo = relative(resolve(repo), target);
      if (inRepo.startsWith('..')) throw new Error(`link-node-modules: ${link} points outside the repo (${target})`);
      // relative, as pnpm writes it (../../src/engine): it stays inside whatever tree holds it, even one nested in this
      // export (a test's throwaway repo)
      symlinkSync(relative(join(to, name), join(resolve(tree), inRepo)), join(to, name, pkg));
    }
  }
  linkWorkspaceSources(tree, to);
  linkPackageNodeModules(repo, tree);
}

/**
 * Drop a scope link that reaches no package. Only a manifest proves one: when a package leaves the workspace, git removes
 * its tracked files but keeps its ignored node_modules, so the old link still resolves to a folder with nothing to import.
 */
function dropStaleScopeLinks(to) {
  for (const name of WORKSPACE_SCOPES) {
    const scope = join(to, name);
    if (!existsSync(scope)) continue;
    for (const pkg of readdirSync(scope)) {
      const link = join(scope, pkg);
      if (lstatSync(link).isSymbolicLink() && !existsSync(join(link, 'package.json'))) unlinkSync(link);
    }
  }
}

/** A package that left the workspace leaves a stale link in an older export's node_modules: point it at the install. */
function linkInstalledScope(repo, tree, from, to) {
  for (const name of WORKSPACE_SCOPES) {
    if (!existsSync(join(from, name))) continue;
    for (const pkg of readdirSync(join(from, name))) {
      const link = join(to, name, pkg), target = resolve(join(from, name), readlinkSync(join(from, name, pkg)));
      if (relative(resolve(repo), target).startsWith('src/')) continue;
      if (present(link)) {
        // A reused slot follows the install: a format release must reach it. A tree holding its own src/<pkg> keeps its link.
        if (existsSync(resolve(tree, 'src', pkg, 'package.json')) || !lstatSync(link).isSymbolicLink() || realpathSync(link) === realpathSync(target)) continue;
        unlinkSync(link);
      }
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(target, link);
    }
  }
}

/** Link newly available defining packages on both first use and reruns. */
function linkWorkspaceSources(tree, to) {
  // A newly authored workspace may not have been installed in the shared checkout yet.
  // Link the export's own defining package, never another checkout's source or dependencies.
  const sources = resolve(tree, 'src');
  if (existsSync(sources)) for (const entry of readdirSync(sources, { withFileTypes: true })) {
    const manifest = join(sources, entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(manifest)) continue;
    const name = JSON.parse(readFileSync(manifest, 'utf8')).name;
    if (typeof name !== 'string' || !/^@wildshard\/[a-z][a-z0-9-]*$/u.test(name)) continue;
    const link = join(to, name);
    if (present(link)) continue;
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(relative(dirname(link), join(sources, entry.name)), link);
  }
}

/**
 * a workspace package's own dependencies (pnpm installs them in `src/<package>/node_modules`, e.g. the SDK's `sharp`):
 * each entry links to the checkout's installed copy, and a workspace package (`@wildshard/*`) to the tree's own sources
 */
function linkPackageNodeModules(repo, tree) {
  const src = resolve(repo, 'src');
  if (!existsSync(src)) return;
  for (const pkg of readdirSync(src)) {
    const from = join(src, pkg, 'node_modules'), to = resolve(tree, 'src', pkg, 'node_modules');
    if (!existsSync(from) || !existsSync(resolve(tree, 'src', pkg))) continue;
    if (existsSync(to)) {
      dropStaleScopeLinks(to);
      linkInstalledScope(repo, tree, from, to);
      linkMissingDependencies(repo, resolve(tree, 'src', pkg), to);
      continue;
    }
    mkdirSync(to);
    const mirror = (fromDir, toDir) => {
      for (const name of readdirSync(fromDir)) {
        if (name === '.bin') continue;
        const entry = join(fromDir, name);
        if (lstatSync(entry).isSymbolicLink()) {
          const target = realpathSync(entry), inSrc = relative(src, target);
          // a workspace package resolves to the tree's copy of the same source; anything else is the installed package
          symlinkSync(inSrc.startsWith('..') ? target : resolve(tree, 'src', inSrc), join(toDir, name));
        } else if (lstatSync(entry).isDirectory()) { mkdirSync(join(toDir, name)); mirror(entry, join(toDir, name)); }
      }
    };
    mirror(from, to);
    linkMissingDependencies(repo, resolve(tree, 'src', pkg), to);
  }
}

/**
 * the tree's manifest can name a dependency the checkout's package folder lacks (an install made from a different working
 * manifest, e.g. another agent's uncommitted package.json): link pnpm's stored copy of exactly that version when it is
 * installed (`node_modules/.pnpm/<name>@<version>…/node_modules/<name>`), so a clean export resolves what its commit declares
 */
function linkMissingDependencies(repo, pkgDir, to) {
  const manifest = join(pkgDir, 'package.json'), store = resolve(repo, 'node_modules', '.pnpm');
  if (!existsSync(manifest) || !existsSync(store)) return;
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  const deps = { ...json.dependencies, ...json.devDependencies, ...json.optionalDependencies };
  const entries = readdirSync(store);
  for (const [name, range] of Object.entries(deps)) {
    if (typeof range !== 'string' || present(join(to, name))) continue;
    if (range.startsWith('workspace:')) {
      const sources = resolve(pkgDir, '..');
      const local = readdirSync(sources).find(entry => {
        const file = join(sources, entry, 'package.json');
        return existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === name;
      });
      if (local === undefined) throw new Error(`link-node-modules: missing workspace dependency ${name}`);
      const link = join(to, name); mkdirSync(dirname(link), { recursive: true });
      symlinkSync(relative(dirname(link), join(sources, local)), link);
      continue;
    }
    const prefix = `${name.replace('/', '+')}@${range.replace(/^[\^~=]/u, '')}`;
    const hit = entries.find((entry) => entry === prefix || entry.startsWith(`${prefix}_`));
    const target = hit === undefined ? undefined : join(store, hit, 'node_modules', name);
    if (target === undefined || !existsSync(target)) continue;
    mkdirSync(dirname(join(to, name)), { recursive: true });
    symlinkSync(target, join(to, name));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [repo, tree] = process.argv.slice(2);
  if (!repo || !tree) { console.error('usage: node scripts/link-node-modules.mjs <repo> <tree>'); process.exit(2); }
  linkNodeModules(repo, tree);
}
