// Meta STAGING-SMOKE SM3: the Opus vision judge. After the hard checks, one `claude -p --model claude-opus-5-5` call per
// scenario looks at a two-row contact sheet (the last release's six keyframes over this one's, ffmpeg) with the release's
// changelog bullets, and answers `same`, `changed` (named by a bullet) or `regressed` (a severity and one line). No previous
// frames: `baseline`, and no call. Five calls a release at most; each reads one ~1600x1170 JPEG and a short prompt.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { KEYFRAMES } from './scenarios.mjs';

/** @typedef {'same' | 'changed' | 'regressed' | 'baseline' | 'error' | 'skipped'} VisionVerdict */
/** @typedef {{ scenario: string, verdict: VisionVerdict, severity?: 'P0' | 'P1' | 'P2', bullet?: string, line: string, sheet?: string }} Vision */

export const VISION_MODEL = 'claude-opus-5-5';
/** Where the call runs: outside every repo, so no project instructions or hooks load (the sheet's folder is added for Read). */
const VISION_CWD = join(homedir(), '.cache/wildshard/plan-artifacts');
const CELL = { w: 268, h: 583 };

/**
 * A two-row sheet: `top` (last release) over `bottom` (this one), one column per keyframe; a missing frame is black.
 * @param {readonly (string | undefined)[]} top @param {readonly (string | undefined)[]} bottom @param {string} out
 */
export function contactSheet(top, bottom, out) {
  mkdirSync(dirname(out), { recursive: true });
  /** @type {string[]} */
  const inputs = [];
  for (const path of [...top, ...bottom]) {
    if (path !== undefined && existsSync(path)) inputs.push('-i', path);
    else inputs.push('-f', 'lavfi', '-i', `color=c=black:s=${String(CELL.w)}x${String(CELL.h)}:d=1`);
  }
  const n = Math.max(top.length, bottom.length);
  if (top.length !== n || bottom.length !== n) throw new Error('A contact sheet needs as many frames on top as below');
  const scaled = Array.from({ length: n * 2 }, (_, i) => `[${String(i)}:v]scale=${String(CELL.w)}:${String(CELL.h)},setsar=1[s${String(i)}]`);
  const row = (/** @type {number} */ from, /** @type {string} */ name) => `${Array.from({ length: n }, (_, i) => `[s${String(from + i)}]`).join('')}hstack=inputs=${String(n)}[${name}]`;
  const graph = [...scaled, row(0, 'top'), row(n, 'bottom'), '[top][bottom]vstack=inputs=2,pad=iw:ih+8:0:4[out]'].join(';');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-q:v', '4', out], { stdio: 'ignore' });
  return out;
}

const KEYFRAME_COLUMNS = `${KEYFRAMES.join(', ')} (title screen, Shard Select, loading card, 1 s into play, 10 s into play, the last frame)`;

/** The prompt for one scenario. `columns` names the sheet's columns (default: the six keyframes).
 * @param {{ sheet: string, scenario: string, title: string, last: string, release: string, bullets: readonly string[], columns?: string }} o */
export function visionPrompt({ sheet, scenario, title, last, release, bullets, columns = KEYFRAME_COLUMNS }) {
  return [
    `Read the image ${sheet}. It is a contact sheet from an automated phone smoke test of a browser game (scenario ${scenario}, ${title}).`,
    `Top row: the last release, ${last}. Bottom row: this release, ${release}. Columns, left to right: ${columns}. A black cell is a frame that was not captured.`,
    `This release's changelog bullets:\n${bullets.length === 0 ? '(none)' : bullets.map((b) => `- ${b}`).join('\n')}`,
    'Compare each bottom cell with the one above it. Ignore small differences: camera angle, the player position, time of day, animation phase, particles.',
    'Answer "same" when nothing a player would notice differs; "changed" when a visible difference is explained by one changelog bullet (quote it in "bullet");',
    '"regressed" when the bottom row looks broken or worse with no bullet explaining it: a menu or blank where the world was, an error, missing HUD, missing or',
    'untextured world, a wrong screen. Severity: P0 blocks play, P1 looks broken, P2 polish.',
    'Reply with only one JSON object, no prose: {"verdict":"same"|"changed"|"regressed","severity":"P0"|"P1"|"P2"|null,"bullet":string|null,"line":"one short sentence"}',
  ].join('\n');
}

/** The last JSON object in a model reply, checked. @param {string} text @returns {Omit<Vision, 'scenario'> | undefined} */
export function parseVision(text) {
  const matches = text.match(/\{[^{}]*"verdict"[^{}]*\}/gu);
  const raw = matches?.at(-1);
  if (raw === undefined) return undefined;
  try {
    const v = JSON.parse(raw);
    if (!['same', 'changed', 'regressed'].includes(v.verdict)) return undefined;
    const severity = ['P0', 'P1', 'P2'].includes(v.severity) ? v.severity : v.verdict === 'regressed' ? 'P1' : undefined;
    return { verdict: v.verdict, line: String(v.line ?? ''), ...(severity === undefined || v.verdict !== 'regressed' ? {} : { severity }), ...(typeof v.bullet === 'string' && v.bullet !== '' ? { bullet: v.bullet } : {}) };
  } catch { return undefined; }
}

/**
 * Ask Claude about one sheet. `claude` is whatever is first on PATH (the test puts a stub there). The call runs from
 * ~/.cache/wildshard/plan-artifacts (outside every repo, so no project instructions load), with only the Read tool and the
 * sheet's folder (`cwd`) added.
 * @param {string} prompt @param {string} cwd @param {{ claude?: string, timeoutMs?: number }} [o] @returns {Omit<Vision, 'scenario'>}
 */
export function askClaude(prompt, cwd, { claude = 'claude', timeoutMs = 240_000 } = {}) {
  /** @type {string} */
  let out;
  try {
    out = execFileSync(claude, ['-p', prompt, '--model', VISION_MODEL, '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read',
      '--add-dir', cwd, '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands'], { cwd: VISION_CWD, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return { verdict: 'error', line: `claude -p failed: ${error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error)}` };
  }
  /** @type {string} */
  let text = out;
  try { const wrapped = JSON.parse(out); if (typeof wrapped.result === 'string') text = wrapped.result; } catch { /* plain text */ }
  return parseVision(text) ?? { verdict: 'error', line: `no verdict in the reply: ${text.slice(0, 160)}` };
}

/** The same call as askClaude, without blocking: deploy runs judge several sheets at once (SQ13).
 * @param {string} prompt @param {string} cwd @param {{ claude?: string, timeoutMs?: number }} [o] @returns {Promise<Omit<Vision, 'scenario'>>} */
export async function askClaudeAsync(prompt, cwd, { claude = 'claude', timeoutMs = 120_000 } = {}) {
  const child = spawn(claude, ['-p', prompt, '--model', VISION_MODEL, '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read',
    '--add-dir', cwd, '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands'], { cwd: VISION_CWD, stdio: ['ignore', 'pipe', 'ignore'] });
  /** @type {Buffer[]} */
  const chunks = [];
  child.stdout.on('data', (chunk) => { chunks.push(Buffer.from(chunk)); });
  const timer = setTimeout(() => { child.kill('SIGTERM'); }, timeoutMs);
  /** @type {[number | null]} */
  let closed;
  try { closed = /** @type {[number | null]} */ (await once(child, 'close')); }
  catch (error) { return { verdict: 'error', line: `claude -p failed: ${error instanceof Error ? error.message : String(error)}` }; }
  finally { clearTimeout(timer); }
  if (closed[0] !== 0) return { verdict: 'error', line: `claude -p failed: exit ${String(closed[0])}` };
  const out = Buffer.concat(chunks).toString('utf8');
  let text = out;
  try { const wrapped = JSON.parse(out); if (typeof wrapped.result === 'string') text = wrapped.result; } catch { /* plain text */ }
  return parseVision(text) ?? { verdict: 'error', line: `no verdict in the reply: ${text.slice(0, 160)}` };
}

/** STAGING-QA SQ13: the most model calls one deploy run makes, and how many run at once. */
export const VISION_MAX_CALLS = 12, VISION_PARALLEL = 4;

/**
 * SQ13, the deploy judge (report-only, J428): one sheet per scenario against the last release (K6: one column per card), no
 * call for a scenario whose hard checks already hold, at most `maxCalls` calls, `parallel` at a time.
 * @param {{ scenarios: readonly { id: string, title: string, status: string, frames: Record<string, string>, cells?: readonly string[] }[],
 *   held: ReadonlySet<string>, release: string, last?: { release: string, dir: string }, bullets: readonly string[], out: string,
 *   claude?: string, timeoutMs?: number, maxCalls?: number, parallel?: number }} o @returns {Promise<Vision[]>}
 */
export async function deployVision({ scenarios, held, release, last, bullets, out, claude, timeoutMs, maxCalls = VISION_MAX_CALLS, parallel = VISION_PARALLEL }) {
  /** @type {(Vision | (() => Promise<Vision>))[]} */
  const rows = [];
  let calls = 0;
  for (const s of scenarios.filter((row) => row.status !== 'skip')) {
    if (held.has(s.id)) { rows.push({ scenario: s.id, verdict: 'skipped', line: 'its hard checks already hold' }); continue; }
    const names = s.id === 'K6' ? (s.cells ?? []).map((cell) => `cell-${cell}`) : [...KEYFRAMES];
    const before = names.map((name) => { const p = last === undefined ? undefined : join(last.dir, s.id, 'frames', `${name}.jpg`); return p !== undefined && existsSync(p) ? p : undefined; });
    if (last === undefined || names.length === 0 || before.every((p) => p === undefined)) {
      rows.push({ scenario: s.id, verdict: 'baseline', line: 'no frames from a previous release: these are the baseline' });
      continue;
    }
    if (calls >= maxCalls) { rows.push({ scenario: s.id, verdict: 'skipped', line: `over the ${String(maxCalls)}-call cap` }); continue; }
    calls++;
    const sheet = contactSheet(before, names.map((name) => s.frames[name]), join(out, s.id, 'sheet.jpg'));
    const columns = s.id === 'K6' ? `one Shard Select card each, a few seconds into play: ${(s.cells ?? []).join(', ')}` : KEYFRAME_COLUMNS;
    const prompt = visionPrompt({ sheet, scenario: s.id, title: s.title, last: last.release, release, bullets, columns });
    rows.push(async () => {
      const answer = await askClaudeAsync(prompt, dirname(sheet), { ...(claude === undefined ? {} : { claude }), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      return { scenario: s.id, ...answer, sheet };
    });
  }
  /** @type {Vision[]} */
  const done = rows.map((row) => typeof row === 'function' ? { scenario: '', verdict: 'error', line: '' } : row);
  const queue = rows.flatMap((row, index) => typeof row === 'function' ? [{ row, index }] : []);
  const worker = async () => { for (let next = queue.shift(); next !== undefined; next = queue.shift()) done[next.index] = await next.row(); };
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
  return done;
}

/** The release's changelog bullets from CHANGELOG.md (`## vX.Y.Z (date)` then `- ` lines). @param {string} file @param {string} release */
export function changelogBullets(file, release) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const heading = `## ${release}`;
  const start = lines.findIndex((line) => line === heading ? true : line.startsWith(`${heading} `));
  if (start === -1) return [];
  /** @type {string[]} */
  const bullets = [];
  for (const line of lines.slice(start + 1)) { if (line.startsWith('## ')) break; if (line.startsWith('- ')) bullets.push(line.slice(2).trim()); }
  return bullets;
}

/**
 * The vision pass over every scenario that ran: a sheet each against the last release's frames, then one call.
 * @param {{ scenarios: readonly { id: string, title: string, status: string, frames: Record<string, string> }[], release: string,
 *   last?: { release: string, dir: string }, bullets: readonly string[], out: string, claude?: string, timeoutMs?: number }} o @returns {Vision[]}
 */
export function visionPass({ scenarios, release, last, bullets, out, claude, timeoutMs }) {
  return scenarios.filter((s) => s.status !== 'skip').map((s) => {
    const before = last === undefined ? [] : KEYFRAMES.map((k) => { const p = join(last.dir, s.id, 'frames', `${k}.jpg`); return existsSync(p) ? p : undefined; });
    if (last === undefined || before.every((p) => p === undefined)) return { scenario: s.id, verdict: /** @type {const} */ ('baseline'), line: 'no frames from a previous release: these are the baseline' };
    const sheet = contactSheet(before, KEYFRAMES.map((k) => s.frames[k]), join(out, s.id, 'sheet.jpg'));
    const answer = askClaude(visionPrompt({ sheet, scenario: s.id, title: s.title, last: last.release, release, bullets }), dirname(sheet),
      { ...(claude === undefined ? {} : { claude }), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    /** @type {Vision} */
    const row = { scenario: s.id, verdict: answer.verdict, line: answer.line, sheet };
    if (answer.severity !== undefined) row.severity = answer.severity;
    if (answer.bullet !== undefined) row.bullet = answer.bullet;
    return row;
  });
}

/** Regressions as findings (severity from the model, P1 when it gave none). @param {readonly Vision[]} vision */
export function visionFindings(vision) {
  return vision.filter((v) => v.verdict === 'regressed').map((v) => {
    /** @type {import('./checks.mjs').Finding & { sheet?: string }} */
    const f = { scenario: v.scenario, key: 'vision', severity: v.severity ?? 'P1', text: `vision: ${v.line}`, source: 'vision' };
    if (v.sheet !== undefined) { f.frame = v.sheet; f.sheet = v.sheet; }
    return f;
  });
}
