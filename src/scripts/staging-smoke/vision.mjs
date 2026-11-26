// Meta STAGING-SMOKE SM3: the Opus vision judge. After the hard checks, one Opus judge per scenario looks at a two-row
// contact sheet (the last release's six keyframes over this one's, ffmpeg) with the release's changelog bullets, and answers
// `same`, `changed` (named by a bullet) or `regressed` (a severity and one line). No previous frames: `baseline`, and no judge.
// J474 (Jake: "Claude -p is bad we need to stop"): each judge is an interactive Claude in a herdr pane of its own, never
// `claude -p`. With no herdr (HERDR_ENV unset, as in CI) the verdict is `skipped` and nothing is started.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { KEYFRAMES } from './scenarios.mjs';

/** @typedef {'same' | 'changed' | 'regressed' | 'baseline' | 'error' | 'skipped'} VisionVerdict */
/** @typedef {{ scenario: string, verdict: VisionVerdict, severity?: 'P0' | 'P1' | 'P2', bullet?: string, line: string, sheet?: string }} Vision */

export const VISION_MODEL = 'claude-opus-5-5';
/** Where the judge runs: outside every repo, so no project instructions or hooks load (the sheet's folder is added). */
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

/** One CLI call's stdout; a non-zero exit or the timeout throws. @param {string} file @param {readonly string[]} args @param {number} timeout */
async function run(file, args, timeout) {
  const child = spawn(file, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  /** @type {Buffer[]} */
  const out = [], err = [];
  child.stdout.on('data', (chunk) => { out.push(Buffer.from(chunk)); });
  child.stderr.on('data', (chunk) => { err.push(Buffer.from(chunk)); });
  const timer = setTimeout(() => { child.kill('SIGTERM'); }, timeout);
  /** @type {[number | null]} */
  let closed;
  try { closed = /** @type {[number | null]} */ (await once(child, 'close')); } finally { clearTimeout(timer); }
  if (closed[0] !== 0) throw new Error(`${file} ${args.slice(0, 2).join(' ')}: exit ${String(closed[0])} ${Buffer.concat(err).toString('utf8').trim().slice(0, 200)}`);
  return Buffer.concat(out).toString('utf8');
}
/** @typedef {{ herdr?: string, timeoutMs?: number, env?: NodeJS.ProcessEnv, workRoot?: string }} JudgeOptions */

/** The judge's own Claude arguments (after `herdr agent start … --`): Opus, only Read and Write, no MCP servers and no slash
 *  commands. No `--add-dir`: a folder inside a repo asks Claude Code's trust question for the whole repo, so the judge works
 *  only in its own folder. Never `-p` / `--print` (J474). */
export function judgeArgs() {
  return ['--model', VISION_MODEL, '--tools', 'Read,Write', '--allowedTools', 'Read,Write', '--strict-mcp-config', '--disable-slash-commands'];
}

/** The prompt's last line: the verdict goes to a file, which the caller reads (a pane's screen is no reply channel).
 * @param {string} file */
export const writeVerdict = (file) => `Do not reply with the JSON. Write that one JSON object, and nothing else, to the file ${file} with the Write tool, then reply only: done.`;

/** @param {string} herdr @param {readonly string[]} args @param {number} timeout @returns {Promise<any>} */
async function herdrCall(herdr, args, timeout) {
  const stdout = await run(herdr, args, timeout);
  try { return JSON.parse(stdout); } catch { return {}; }
}

/**
 * J474: ask one Opus judge about one sheet. The judge gets a folder of its own under ~/.cache/wildshard/plan-artifacts/vision-judge
 * (outside every repo, already trusted, so no project instructions load and no trust question stops it) holding a copy of the
 * sheet. It splits a pane off the caller's (no focus, that folder its cwd, CC_SOUND_VOL=0 so it never chimes), starts an
 * interactive Claude there (`herdr agent start --kind claude`), prompts it and waits for it to settle. The judge writes its JSON
 * verdict beside the copy; that file is copied to `verdictFile` (the run's tmp/<lane>, beside the sheet) and read, then the pane
 * is closed and the folder removed. No herdr (`HERDR_ENV` unset, as in CI): `skipped`, nothing started. `herdr` is whatever is
 * first on PATH (the test puts a stub there).
 * @param {(sheet: string) => string} promptFor the prompt, given the path of the sheet the judge reads
 * @param {string} sheet @param {string} verdictFile @param {JudgeOptions} [o] @returns {Promise<Omit<Vision, 'scenario'>>}
 */
export async function askJudge(promptFor, sheet, verdictFile, { herdr = 'herdr', timeoutMs = 240_000, env = process.env, workRoot = VISION_CWD } = {}) {
  if (env.HERDR_ENV !== '1') return { verdict: 'skipped', line: 'no herdr: the judge runs only as an interactive Claude in a herdr pane (J474)' };
  mkdirSync(dirname(verdictFile), { recursive: true });
  rmSync(verdictFile, { force: true });
  const name = `judge-${randomBytes(4).toString('hex')}`, from = env.HERDR_PANE_ID;
  const work = join(workRoot, 'vision-judge', name), copy = join(work, 'sheet.jpg'), written = join(work, 'verdict.json');
  /** @type {string | undefined} */
  let pane;
  try {
    mkdirSync(work, { recursive: true });
    copyFileSync(sheet, copy);
    const split = await herdrCall(herdr, ['pane', 'split', ...(from === undefined || from === '' ? ['--current'] : ['--pane', from]), '--direction', 'down',
      '--cwd', work, '--env', 'CC_SOUND_VOL=0', '--no-focus'], 30_000);
    pane = split?.result?.pane?.pane_id;
    if (typeof pane !== 'string') return { verdict: 'error', line: 'herdr split no pane for the judge' };
    await herdrCall(herdr, ['agent', 'start', name, '--kind', 'claude', '--pane', pane, '--timeout', '60000', '--', ...judgeArgs()], 90_000);
    await herdrCall(herdr, ['agent', 'prompt', name, `${promptFor(copy)}\n${writeVerdict(written)}`, '--wait', '--timeout', String(timeoutMs)], timeoutMs + 15_000);
    if (!existsSync(written)) return { verdict: 'error', line: `the judge wrote no verdict (${name})` };
    copyFileSync(written, verdictFile);
    const text = readFileSync(verdictFile, 'utf8');
    return parseVision(text) ?? { verdict: 'error', line: `no verdict in ${verdictFile}: ${text.slice(0, 160)}` };
  } catch (error) {
    return { verdict: 'error', line: `the herdr judge failed: ${error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error)}` };
  } finally {
    if (pane !== undefined) await run(herdr, ['pane', 'close', pane], 15_000).catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  }
}

/** STAGING-QA SQ13: the most judges one deploy run starts, and how many at once (J474: each is a pane split off the caller's,
 *  so two, not four, keep them readable). */
export const VISION_MAX_CALLS = 12, VISION_PARALLEL = 2;

/**
 * SQ13, the deploy judge (report-only, J428): one sheet per scenario against the last release (K6: one column per card), no
 * call for a scenario whose hard checks already hold, at most `maxCalls` calls, `parallel` at a time.
 * @param {{ scenarios: readonly { id: string, title: string, status: string, frames: Record<string, string>, cells?: readonly string[] }[],
 *   held: ReadonlySet<string>, release: string, last?: { release: string, dir: string }, bullets: readonly string[], out: string,
 *   maxCalls?: number, parallel?: number } & JudgeOptions} o @returns {Promise<Vision[]>}
 */
export async function deployVision({ scenarios, held, release, last, bullets, out, herdr, timeoutMs, workRoot, env = process.env, maxCalls = VISION_MAX_CALLS, parallel = VISION_PARALLEL }) {
  const judge = { ...(herdr === undefined ? {} : { herdr }), ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(workRoot === undefined ? {} : { workRoot }) };
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
    if (env.HERDR_ENV !== '1') { rows.push({ scenario: s.id, verdict: 'skipped', line: 'no herdr: the judge runs only as an interactive Claude in a herdr pane (J474)' }); continue; }
    if (calls >= maxCalls) { rows.push({ scenario: s.id, verdict: 'skipped', line: `over the ${String(maxCalls)}-call cap` }); continue; }
    calls++;
    const sheet = contactSheet(before, names.map((name) => s.frames[name]), join(out, s.id, 'sheet.jpg'));
    const columns = s.id === 'K6' ? `one Shard Select card each, a few seconds into play: ${(s.cells ?? []).join(', ')}` : KEYFRAME_COLUMNS;
    const promptFor = (/** @type {string} */ read) => visionPrompt({ sheet: read, scenario: s.id, title: s.title, last: last.release, release, bullets, columns });
    rows.push(async () => {
      const answer = await askJudge(promptFor, sheet, join(dirname(sheet), 'verdict.json'), { env, ...judge });
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
 * The vision pass over every scenario that ran: a sheet each against the last release's frames, then one judge, in turn.
 * @param {{ scenarios: readonly { id: string, title: string, status: string, frames: Record<string, string> }[], release: string,
 *   last?: { release: string, dir: string }, bullets: readonly string[], out: string } & JudgeOptions} o @returns {Promise<Vision[]>}
 */
export async function visionPass({ scenarios, release, last, bullets, out, herdr, timeoutMs, workRoot, env = process.env }) {
  const judge = { ...(herdr === undefined ? {} : { herdr }), ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(workRoot === undefined ? {} : { workRoot }) };
  /** @type {Vision[]} */
  const rows = [];
  for (const s of scenarios.filter((row) => row.status !== 'skip')) rows.push(await (async () => {
    const before = last === undefined ? [] : KEYFRAMES.map((k) => { const p = join(last.dir, s.id, 'frames', `${k}.jpg`); return existsSync(p) ? p : undefined; });
    if (last === undefined || before.every((p) => p === undefined)) return { scenario: s.id, verdict: /** @type {const} */ ('baseline'), line: 'no frames from a previous release: these are the baseline' };
    const sheet = contactSheet(before, KEYFRAMES.map((k) => s.frames[k]), join(out, s.id, 'sheet.jpg'));
    const answer = await askJudge((read) => visionPrompt({ sheet: read, scenario: s.id, title: s.title, last: last.release, release, bullets }), sheet,
      join(dirname(sheet), 'verdict.json'), { env, ...judge });
    /** @type {Vision} */
    const row = { scenario: s.id, verdict: answer.verdict, line: answer.line, sheet };
    if (answer.severity !== undefined) row.severity = answer.severity;
    if (answer.bullet !== undefined) row.bullet = answer.bullet;
    return row;
  })());
  return rows;
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
