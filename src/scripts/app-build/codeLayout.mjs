/** Fix-preview PV9 (Jake, 2026-11-26: "folder per build but human readable `builds/[engineVersion]/[build]/*`"): a page
 * build's own code sits under `builds/<engineVersion>/<build>/`, its content-named shared code under `builds/shared/`, and
 * engine art keeps its hashed name under `assets/`, outside any build folder, so Workers upload it once. The legacy `b/`
 * holds only the builds a deploy carries from before PV9. This is the build's check of that layout, run once the kept
 * builds are carried in; test/code-layout.test.ts pins it. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SHARED_CODE_DIRECTORY, codeDirectory } from './buildIdentity.mjs';

/** Workers static assets: 20,000 files a version on the plan the pages use (fix-preview "What a preview page will hold"). */
export const MAX_PAGE_FILES = 20_000;
const MAP = /\.map(?:\.(?:gz|br))?$/u;

/** @param {string} root @returns {string[]} */
function walk(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name));
}

/**
 * Refuse a page whose code is not under PV9's layout: this build's folder holds its entry, every code URL its documents
 * load sits in that folder or the shared one, its own graph in deploy-chunks.json names nothing under the legacy `b/`,
 * and the page holds fewer than MAX_PAGE_FILES files (source maps are stripped before upload, so they don't count).
 * @param {string} outDir
 * @returns {{own: string, files: number}}
 */
export function checkCodeLayout(outDir) {
  /** @type {{build?: unknown, clientVersion?: unknown}} */
  const version = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8'));
  if (typeof version.build !== 'string' || typeof version.clientVersion !== 'string') throw new Error('PV9: version.json names no build or engine version');
  const own = codeDirectory(version.build, version.clientVersion);
  if (!walk(join(outDir, own)).some(path => path.endsWith('.js'))) throw new Error(`PV9: this build's code folder ${own}/ holds no code`);
  const allowed = (/** @type {string} */ path) => path.startsWith(`${own}/`) || path.startsWith(`${SHARED_CODE_DIRECTORY}/`);
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  for (const match of html.matchAll(/\b(?:src|href)="\/((?:builds|b)\/[^"]+)"/gu)) {
    const path = match[1] ?? '';
    if (!allowed(path)) throw new Error(`PV9: index.html loads /${path}, outside ${own}/ and ${SHARED_CODE_DIRECTORY}/`);
  }
  const chunks = join(outDir, 'deploy-chunks.json');
  if (existsSync(chunks)) {
    /** @type {{builds?: {build: string, files: {path: string}[]}[]}} */
    const manifest = JSON.parse(readFileSync(chunks, 'utf8'));
    const graph = manifest.builds?.find(row => row.build === version.build);
    if (graph === undefined) throw new Error(`PV9: deploy-chunks.json names no graph for ${version.build}`);
    const stray = graph.files.find(row => row.path.startsWith('b/') || (row.path.startsWith('builds/') && !allowed(row.path)));
    if (stray !== undefined) throw new Error(`PV9: this build's graph names ${stray.path}, outside ${own}/ and ${SHARED_CODE_DIRECTORY}/`);
  }
  const files = walk(outDir).filter(path => !MAP.test(path)).length;
  if (files >= MAX_PAGE_FILES) throw new Error(`PV9: the page holds ${files} files, at or over Workers static assets' ${MAX_PAGE_FILES}`);
  return { own: relative(outDir, join(outDir, own)), files };
}
