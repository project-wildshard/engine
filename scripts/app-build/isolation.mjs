import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PAGE-SIZE PZ12 (J274, preview first): cross-origin isolation per channel. An isolated channel's page origin answers every
 * path with COOP `same-origin` and COEP `require-corp` (its build appends one `/*` rule to `dist/_headers`), so the
 * document, its module workers and the standalone server worker's script all carry them. The service worker answers a
 * navigation with its baked document; it sends the same two headers, read from that rule, so a load it serves is isolated
 * like one the network serves. Content on packs.wildshard.io passes: every read there is CORS, and PC1 sends CORP.
 * Staging and production join as J274 rolls out: add them here.
 */
export const ISOLATED_CHANNELS = new Set(['preview']);
export const ISOLATION_HEADERS = Object.freeze({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
const MARK = '# PAGE-SIZE PZ12 (J274): this channel is cross-origin isolated';

/** @param {string | undefined} channel */
export const isolated = channel => channel !== undefined && ISOLATED_CHANNELS.has(channel);

/** The `_headers` text with the isolation rule appended (once) for an isolated channel; unchanged for any other.
 * @param {string} text @param {string | undefined} channel */
export function withIsolationRule(text, channel) {
  if (!isolated(channel) || text.includes(MARK)) return text;
  const rule = Object.entries(ISOLATION_HEADERS).map(([name, value]) => `  ${name}: ${value}`).join('\n');
  return `${text.endsWith('\n') ? text : `${text}\n`}\n${MARK}\n/*\n${rule}\n`;
}

/** Append the rule to a build's `_headers`. @param {string} outDir @param {string | undefined} channel @returns {boolean} isolated */
export function writeIsolationRule(outDir, channel) {
  const file = join(outDir, '_headers'), text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const next = withIsolationRule(text, channel);
  if (next !== text) appendFileSync(file, next.slice(text.length));
  return isolated(channel);
}

/** The COOP and COEP a `_headers` text sends on `/` (from its `/*` rules), lower-cased, for the service worker's document.
 * @param {string} text @returns {Record<string, string>} */
export function documentIsolation(text) {
  /** @type {Record<string, string>} */ const out = {};
  let all = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/u.test(line)) { all = line.trim() === '/*'; continue; }
    const match = /^\s+(Cross-Origin-(?:Opener|Embedder)-Policy):\s*(.+?)\s*$/iu.exec(line);
    if (all && match?.[1] !== undefined && match[2] !== undefined) out[match[1].toLowerCase()] = match[2];
  }
  return out;
}
