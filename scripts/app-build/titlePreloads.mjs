import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PZ18 (meta PAGE-SIZE, QA 11-13 row 29): the title's code comes in the first wave. The entry imports the grid's page
 * entry (`src/client/game/grid/pageEntry.ts`) dynamically, so its static closure (the title-0 chunks) was only requested
 * once the entry had run: two serial round trips after the module graph (preview, throttled: 1.07 to 1.29 s of a 1.53 s
 * title). The built document now names every chunk of that closure as a `modulepreload` beside the entry's own, so the
 * browser fetches them with the first wave. Splicing the links into preview's document moved the throttled title from
 * 1.54-1.56 s to 1.26-1.39 s.
 */
export const TITLE_PRELOAD_ROOT = 'src/client/game/grid/pageEntry.ts';

const clean = (/** @type {string} */ id) => id.replaceAll('\\', '/').split('?')[0];
const PRELOAD = /<link\b[^>]*\brel="modulepreload"[^>]*>/gu;
const HREF = /\bhref="\/([^"]+)"/u;
const MODULE_SCRIPT = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/([^"]+)"[^>]*>/gu;

/**
 * The chunks of the title root's static closure (its own chunks first, then each one's static imports) that the document
 * neither preloads nor loads as its module script already. Empty when no chunk holds the root (a fixture build).
 * @param {Record<string, {moduleIds: string[], imports: string[]}>} report `.vite/chunk-modules.json`
 * @param {string} html the built document
 * @param {string} [root]
 * @returns {string[]} chunk files, relative to the output folder
 */
export function titlePreloadFiles(report, html, root = TITLE_PRELOAD_ROOT) {
  const loaded = new Set([...html.matchAll(PRELOAD)].map(match => HREF.exec(match[0])?.[1]).filter(file => file !== undefined));
  for (const match of html.matchAll(MODULE_SCRIPT)) if (match[1] !== undefined) loaded.add(match[1]);
  /** @type {string[]} */ const order = [];
  const seen = new Set();
  /** @param {string} file */
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file); order.push(file);
    const row = report[file];
    if (row === undefined) throw new Error(`title preloads: no chunk report row for ${file}`);
    for (const next of row.imports) visit(next);
  };
  for (const [file, row] of Object.entries(report)) if (row.moduleIds.some(id => clean(id) === root)) visit(file);
  return order.filter(file => !loaded.has(file) && file.endsWith('.js'));
}

/**
 * Add the title closure's `modulepreload` links to `index.html`, right after the document's last one (or before its first
 * module script), in the same form the bundler writes its own.
 * @param {string} html
 * @param {readonly string[]} files
 */
export function withTitlePreloads(html, files) {
  if (files.length === 0) return html;
  const links = files.map(file => `<link rel="modulepreload" crossorigin href="/${file}">`).join('\n');
  const preloads = [...html.matchAll(PRELOAD)], last = preloads.at(-1);
  if (last?.index !== undefined) { const at = last.index + last[0].length; return `${html.slice(0, at)}\n${links}${html.slice(at)}`; }
  const script = /<script\b[^>]*\btype="module"/u.exec(html);
  if (script === null) throw new Error('title preloads: the document has no module script');
  return `${html.slice(0, script.index)}${links}\n${html.slice(script.index)}`;
}

/**
 * @param {string} outDir
 * @param {Record<string, {moduleIds: string[], imports: string[]}>} report
 * @returns {string[]} the chunks it preloads
 */
export function writeTitlePreloads(outDir, report) {
  const path = resolve(outDir, 'index.html'), html = readFileSync(path, 'utf8'), files = titlePreloadFiles(report, html);
  if (files.length > 0) writeFileSync(path, withTitlePreloads(html, files));
  return files;
}
