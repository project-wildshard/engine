import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The deploy identity belongs to the document, not every hashed runtime module.
 * Vite replaces __BUILD_ID__ with this stable expression in both page and worker
 * code; standalone workers without a document have an empty identity. */
export const BUILD_ID_EXPRESSION = '(globalThis.__WS_BUILD_ID__ ?? "")';
export const VALIDATOR_EXPRESSION = 'globalThis.__WS_SHARDFILE_VALIDATOR__';
export const VERDICTS_EXPRESSION = 'globalThis.__WS_SHARDFILE_VERDICTS__';

/** The id a build of a known source gets: its short sha + build time. A caller that builds an exported tree (no .git)
 * passes it as WS_BUILD_ID (OFF-VERCEL OV3: no VERCEL_GIT_COMMIT_SHA).
 * @param {string} sha @param {number} [now] */
export const sourceBuildId = (sha, now = Date.now()) => `${sha === '' ? 'b' : sha.slice(0, 7)}-${now.toString(36)}`;

/** An explicit WS_BUILD_ID coordinates a page with a dedicated server release, or names an exported tree's source.
 * Otherwise mint a short git sha + build time. build-app chooses it first, because the bundler names the folder and
 * version.json serves the same id. WS_BUILD_ID is the only env this reads (OFF-VERCEL OV3). */
export function newBuildId() {
  const requested = process.env.WS_BUILD_ID;
  if (requested !== undefined) {
    if (!/^\w[\w.-]*$/u.test(requested)) throw new Error('Invalid WS_BUILD_ID');
    return requested;
  }
  let sha = '';
  try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
  return sha === '' ? sourceBuildId('') : `${sha}-${Date.now().toString(36)}`;
}

/** J57, J131: a web build's own folder for code, CSS and wasm, immutable for good. Assets stay under /assets/, and only
 * this name in an uncached document points a tab at a build.
 * @param {string} build */
export const codeDirectory = (build) => `b/${build}`;
/** J217 (Jake, 2026-11-09), LD6: a chunk or stylesheet a deploy did not change keeps its URL. Content-named code that is not
 * an entry lives in one folder every build shares, so a phone holds it across deploys; each build's entry and document stay
 * in its own folder, and the deploy carries the old builds' graphs (MF2, J79) as before. */
export const SHARED_CODE_DIRECTORY = 'b/c';

/** The build pill's words for a build (src/client/engine/ui/buildCheck.ts buildLabel, which test/build-identity.test.ts
 * keeps equal): its `git describe`, else "v0.1.5 · a8144a5", either half alone when the other is unknown.
 * @param {string} build @param {{version: string, describe?: string}} release */
export function buildLabelOf(build, { version, describe = '' }) {
  if (describe !== '' && /^[\w .·+-]{1,80}$/u.test(describe)) return describe; // an odd tag never fails a build over a label
  const [gitSha = '', stamp = ''] = build.split('-');
  const short = /^[0-9a-f]{7,40}$/iu.test(gitSha) ? gitSha.slice(0, 7) : gitSha.length >= 7 ? gitSha : stamp;
  return [version === '' ? '' : `v${version}`, short].filter(part => part !== '').join(' · ');
}

/** Stamp before executable module scripts, without changing the bundle's URLs. `label` (QA 11-13) is the build pill's
 * words, which index.html's static title shows before any bundle runs.
 * @param {string} html @param {string} build
 * @param {{validator: string, verdicts: readonly unknown[], world?: {release: string, key: string,recordTag?:string}, label?: string, builtAt?: number}} [facts] */
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
  if (facts?.label !== undefined && !/^[\w .·+-]{1,80}$/u.test(facts.label)) throw new Error('Invalid document build label');
  const label = facts?.label === undefined ? '' : `globalThis.__WS_BUILD_LABEL__=${JSON.stringify(facts.label)};`;
  // STALE-BUILD SB1 (J321): the build time, as a meta a person can read and a number index.html's data-stale-build reads
  const at = facts?.builtAt;
  if (at !== undefined && !(Number.isSafeInteger(at) && at > 0)) throw new Error('Invalid document build time');
  const built = at === undefined ? ['', ''] : [`<meta name="ws-built-at" content="${new Date(at).toISOString()}">`, `globalThis.__WS_BUILT_AT__=${at};`];
  return `${source.slice(0, end)}${built[0]}<script>globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};${built[1]}${admission}${world}${label}</script>${source.slice(end)}`;
}

/** Plain post-bundle step, before the service worker hashes the final HTML.
 * Every document entry gets the same version.json identity, including native
 * index.html and the calibration entry. No new Vite plugin or fetched module.
 * @param {string} directory
 * @param {{validator: string, verdicts: readonly unknown[], world?: {release: string, key: string,recordTag?:string}, label?: string}} [facts] */
export function stampBuildDocuments(directory, facts) {
  /** @type {unknown} */
  const version = JSON.parse(readFileSync(resolve(directory, 'version.json'), 'utf8'));
  if (typeof version !== 'object' || version === null || !('build' in version) || typeof version.build !== 'string') throw new Error('Missing document build identity');
  if (version.rendererRevision !== undefined && (typeof version.rendererRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(version.rendererRevision))) throw new Error('Invalid renderer identity');
  // STALE-BUILD SB1: version.json's `time` is the build's one time (build-app's WS_BUILT_AT)
  const time = 'time' in version && typeof version.time === 'string' ? Date.parse(version.time) : Number.NaN;
  const builtAt = Number.isFinite(time) ? time : undefined;
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
    const html=stampBuildHtml(readFileSync(path, 'utf8'), version.build, builtAt === undefined ? facts : { ...facts, builtAt });
    writeFileSync(path, version.rendererRevision === undefined ? html : html.replace('<script>globalThis.__WS_BUILD_ID__=',`<script>globalThis.__WS_RENDERER_REVISION__=${JSON.stringify(version.rendererRevision)};globalThis.__WS_BUILD_ID__=`));
  }
}
