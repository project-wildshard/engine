import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The deploy identity belongs to the document, not every hashed runtime module.
 * Vite replaces __BUILD_ID__ with this stable expression in both page and worker
 * code; standalone workers without a document have an empty identity. */
export const BUILD_ID_EXPRESSION = '(globalThis.__WS_BUILD_ID__ ?? "")';
export const VALIDATOR_EXPRESSION = 'globalThis.__WS_SHARDFILE_VALIDATOR__';
export const VERDICTS_EXPRESSION = 'globalThis.__WS_SHARDFILE_VERDICTS__';

/** An explicit WS_BUILD_ID coordinates a page with a dedicated server release. Otherwise mint a short git sha + build
 * time. build-app chooses it first, because the bundler names the folder and version.json serves the same id. */
export function newBuildId() {
  const requested = process.env.WS_BUILD_ID;
  if (requested !== undefined) {
    if (!/^\w[\w.-]*$/u.test(requested)) throw new Error('Invalid WS_BUILD_ID');
    return requested;
  }
  let sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7);
  try { if(sha==='')sha=execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
  return `${sha===''?'b':sha}-${Date.now().toString(36)}`;
}

/** J57, J131: a web build's own folder for code, CSS and wasm, immutable for good. Assets stay under /assets/, and only
 * this name in an uncached document points a tab at a build.
 * @param {string} build */
export const codeDirectory = (build) => `b/${build}`;

/** Stamp before executable module scripts, without changing the bundle's URLs.
 * @param {string} html @param {string} build
 * @param {{validator: string, verdicts: readonly unknown[], world?: {release: string, key: string,recordTag?:string}}} [facts] */
export function stampBuildHtml(html, build, facts) {
  if (build.length === 0 || !/^[\w.-]+$/u.test(build)) throw new Error('Invalid document build identity');
  if (html.includes('globalThis.__WS_BUILD_ID__=')) throw new Error('Duplicate document build identity');
  // Vite hoists one extracted sheet back into head. Keep the inline launch /
  // loading shell paintable even if that sheet's response has stalled.
  const source = html.includes('data-loading-first-paint') ? html.replaceAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/giu,
    tag => tag.includes('media=') ? tag : tag.replace(/\s*\/?\s*>$/u, ' media="print" onload="this.media=\'all\'">')) : html;
  const heads = [...source.matchAll(/<head(?:\s[^>]*)?>/giu)];
  if (heads.length !== 1 || heads[0]?.index === undefined) throw new Error('Missing or ambiguous document head');
  const end = heads[0].index + heads[0][0].length;
  if (facts !== undefined && (!/^[a-f0-9]{64}$/u.test(facts.validator) || !Array.isArray(facts.verdicts))) throw new Error('Invalid document admission facts');
  const admission = facts === undefined ? '' : `globalThis.__WS_SHARDFILE_VALIDATOR__=${JSON.stringify(facts.validator)};globalThis.__WS_SHARDFILE_VERDICTS__=${JSON.stringify(facts.verdicts).replaceAll('<', String.raw`\u003c`)};`;
  const world = facts?.world === undefined ? '' : `globalThis.__WS_WORLD__=${JSON.stringify(facts.world).replaceAll('<', String.raw`\u003c`)};`;
  return `${source.slice(0, end)}<script>globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};${admission}${world}</script>${source.slice(end)}`;
}

/** Plain post-bundle step, before the service worker hashes the final HTML.
 * Every document entry gets the same version.json identity, including native
 * index.html and the calibration entry. No new Vite plugin or fetched module.
 * @param {string} directory
 * @param {{validator: string, verdicts: readonly unknown[]}} [facts] */
export function stampBuildDocuments(directory, facts) {
  /** @type {unknown} */
  const version = JSON.parse(readFileSync(resolve(directory, 'version.json'), 'utf8'));
  if (typeof version !== 'object' || version === null || !('build' in version) || typeof version.build !== 'string') throw new Error('Missing document build identity');
  if (version.rendererRevision !== undefined && (typeof version.rendererRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(version.rendererRevision))) throw new Error('Invalid renderer identity');
  const documents = new Set(['index.html']);
  // E7.5 prep: the Connection doctor's page is built on its own (doctorOutput.mjs), so no manifest names it
  if (existsSync(resolve(directory, 'doctor/index.html'))) documents.add('doctor/index.html');
  const manifest = resolve(directory, '.vite/manifest.json');
  if (existsSync(manifest)) {
    /** @type {unknown} */
    const entries = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) throw new Error('Invalid document entry manifest');
    for (const [name, entry] of Object.entries(entries)) {
      if (typeof entry !== 'object' || entry === null || !('isEntry' in entry) || entry.isEntry !== true || !name.endsWith('.html')) continue;
      const path = resolve(directory, name);
      if (!path.startsWith(`${resolve(directory)}/`)) throw new Error('Document entry escapes build');
      documents.add(name);
    }
  }
  for (const name of documents) {
    const path = resolve(directory, name);
    const html=stampBuildHtml(readFileSync(path, 'utf8'), version.build, facts);
    writeFileSync(path, version.rendererRevision === undefined ? html : html.replace('<script>globalThis.__WS_BUILD_ID__=',`<script>globalThis.__WS_RENDERER_REVISION__=${JSON.stringify(version.rendererRevision)};globalThis.__WS_BUILD_ID__=`));
  }
}
