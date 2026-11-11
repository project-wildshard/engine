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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

/** Read pnpm's top-level store scalar: current pinned pnpm emits JSON;
 * older installs use a plain or quoted YAML path. Reject ambiguous/tagged values.
 * This reads only pnpm's path field, not arbitrary YAML documents.
 * @param {string} contents @returns {string | undefined} */
function virtualStoreDirectory(contents) {
  try {
    /** @type {unknown} */ const metadata = JSON.parse(contents);
    if (typeof metadata === 'object' && metadata !== null && Object.hasOwn(metadata, 'virtualStoreDir')
      && 'virtualStoreDir' in metadata && typeof metadata.virtualStoreDir === 'string' && metadata.virtualStoreDir.length > 0) return metadata.virtualStoreDir;
    return undefined;
  } catch { /* Earlier pnpm writes an unindented YAML scalar. */ }
  const rows = contents.split(/\r?\n/u).filter(line => line.startsWith('virtualStoreDir:'));
  if (rows.length !== 1) return undefined;
  const value = rows[0].slice('virtualStoreDir:'.length).trim();
  if (value.startsWith('"')) {
    try { const decoded = JSON.parse(value); return typeof decoded === 'string' && decoded.length > 0 ? decoded : undefined; } catch { return undefined; }
  }
  if (/^'(?:[^']|'')*'$/u.test(value)) return value.slice(1, -1).replaceAll("''", "'") || undefined;
  return /^[a-zA-Z0-9_./\\ :~-]+$/u.test(value) ? value : undefined;
}

/** A pinned pnpm install may keep immutable packages in its registered external
 * virtual store. Resolve both sides so a store symlink cannot lend live source.
 * No other outside checkout is accepted as an installed dependency.
 * @param {string} from @param {string} target @param {string} name
 * @returns {string | undefined}
 */
function installedVirtualStoreTarget(from, target, name) {
  try {
    // Exported installs may link this metadata; its relative store belongs to the original file.
    const metadataFile = realpathSync(join(from, '.modules.yaml'));
    const directory = virtualStoreDirectory(readFileSync(metadataFile, 'utf8'));
    if (directory === undefined) return undefined;
    const store = realpathSync(resolve(dirname(metadataFile), directory)), installed = realpathSync(target), within = relative(store, installed);
    if (within.length === 0 || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) return undefined;
    /** @type {unknown} */
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    if (typeof manifest !== 'object' || manifest === null || !Object.hasOwn(manifest, 'name')
      || !('name' in manifest) || manifest.name !== name) return undefined;
    return installed;
  } catch { return undefined; } // Missing/corrupt metadata is not authority to lend outside source.
}

/** Classify canonical destinations on every path, including retried exports.
 * Source belongs to the frozen tree; only registered installed stores may live outside.
 * @param {string} repo @param {string} tree @param {string} target @param {string} name */
function scopedTarget(repo, tree, target, name) {
  const canonical = realpathSync(target), inRepo = relative(realpathSync(repo), canonical);
  if (inRepo === '') return resolve(tree);
  if (!isAbsolute(inRepo) && inRepo !== '..' && !inRepo.startsWith(`..${sep}`)) {
    return inRepo.startsWith(`src${sep}`) ? resolve(tree, inRepo) : canonical;
  }
  const installed = installedVirtualStoreTarget(resolve(repo, 'node_modules'), canonical, name);
  if (installed === undefined) throw new Error(`link-node-modules: ${name} points outside the repo (${canonical})`);
  return installed;
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
      const destination = scopedTarget(repo, tree, target, `${name}/${pkg}`);
      symlinkSync(destination, join(to, name, pkg));
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
      if (existsSync(resolve(tree, 'src', pkg, 'package.json'))) continue;
      const destination = scopedTarget(repo, tree, target, `${name}/${pkg}`);
      if (present(link)) {
        // A reused slot follows the install: a format release must reach it. A tree holding its own src/<pkg> keeps its link.
        if (existsSync(resolve(tree, 'src', pkg, 'package.json')) || !lstatSync(link).isSymbolicLink() || realpathSync(link) === realpathSync(destination)) continue;
        unlinkSync(link);
      }
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(destination, link);
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
          const specifier = relative(from, entry).split(sep).join('/');
          const destination = specifier.startsWith('@wildshard/') ? scopedTarget(repo, tree, target, specifier)
            : inSrc.startsWith('..') ? target : resolve(tree, 'src', inSrc);
          symlinkSync(destination, join(toDir, name));
        } else if (lstatSync(entry).isDirectory()) { mkdirSync(join(toDir, name)); mirror(entry, join(toDir, name)); }
      }
    };
    mirror(from, to);
    linkMissingDependencies(repo, resolve(tree, 'src', pkg), to);
  }
}

/** The global virtual store's `links/` folder when the checkout's install uses it (GVS G9), from pnpm's own metadata;
 * undefined for a classic install, whose virtual store is the checkout's `node_modules/.pnpm`.
 * @param {string} modules @returns {string | undefined} */
function globalLinks(modules) {
  try {
    const metadataFile = realpathSync(join(modules, '.modules.yaml'));
    const directory = virtualStoreDirectory(readFileSync(metadataFile, 'utf8'));
    if (directory === undefined) return undefined;
    const links = realpathSync(resolve(dirname(metadataFile), directory));
    return links === realpathSync(dirname(metadataFile)) || links.endsWith(`${sep}.pnpm`) ? undefined : links;
  } catch { return undefined; }
}

/** `links/<scope or @>/<name>/<version>/<hash>/node_modules/<name>`: the first installed slot of exactly that version.
 * @param {string} links @param {string} name @param {string} version @returns {string | undefined} */
function globalTarget(links, name, version) {
  const [scope, bare] = name.startsWith('@') ? name.split('/') : ['@', name];
  const folder = join(links, scope, bare, version);
  if (!existsSync(folder)) return undefined;
  return readdirSync(folder).sort().map(hash => join(folder, hash, 'node_modules', name)).find(target => existsSync(target));
}

/**
 * the tree's manifest can name a dependency the checkout's package folder lacks (an install made from a different working
 * manifest, e.g. another agent's uncommitted package.json): link pnpm's stored copy of exactly that version when it is
 * installed (`node_modules/.pnpm/<name>@<version>…/node_modules/<name>`, or the global store's slot of it), so a clean
 * export resolves what its commit declares
 */
function linkMissingDependencies(repo, pkgDir, to) {
  const manifest = join(pkgDir, 'package.json'), store = resolve(repo, 'node_modules', '.pnpm');
  const links = globalLinks(resolve(repo, 'node_modules'));
  if (!existsSync(manifest) || (links === undefined && !existsSync(store))) return;
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  const deps = { ...json.dependencies, ...json.devDependencies, ...json.optionalDependencies };
  const entries = links === undefined ? readdirSync(store) : [];
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
    const version = range.replace(/^[\^~=]/u, ''), prefix = `${name.replace('/', '+')}@${version}`;
    const hit = entries.find((entry) => entry === prefix || entry.startsWith(`${prefix}_`));
    const target = links !== undefined ? globalTarget(links, name, version) : hit === undefined ? undefined : join(store, hit, 'node_modules', name);
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
