// A real Claude Code session, replayed as a terminal (docs/trailer.md): reads a session transcript (the .jsonl Claude Code
// keeps under ~/.claude/projects/) and writes an asciicast that build-beat.mjs renders beside the zone. Nothing is staged:
// every line is the session's own text, tool call or tool result, in order; only the clock is compressed (each step gets
// a fixed beat, so an hour reads in seconds). The pictures the session looked at (its Read of a capture) come out too,
// each at the moment the replay reaches it, so the panel beside the terminal shows what the session saw.
//
//   node scripts/trailer/transcript-cast.mjs <session.jsonl> <out.cast> [--from HH:MM[:SS]] [--to HH:MM[:SS]]
//        [--images <dir>] [--cols 96] [--rows 30] [--compact [--ask <text>] [--prose] [--match <re>] [--pictures <re>]]
//
// --compact is the phone-sized replay (a beat's terminal is read on a phone): no blank lines and no tool output, a tool
// call names only its file or its command's first words (and only the calls that build: SHOWN), and Claude's text keeps
// its first sentence, wrapped, not cut. What a viewer reads is the ask and the answer, so a beat can narrow it further:
//   --ask <text>     opens on the ask as a `>` prompt line; the text must stand word for word in the session's own
//                    first prompt (its brief), or the replay refuses
//   --prose          Claude's words and the pictures only, no tool calls
//   --match <re>     of each of Claude's messages, the first sentence matching re (a message with none is left out)
//   --pictures <re>  only the pictures whose file path matches re
//
// --from / --to keep the span between those UTC clock times (the transcript's own timestamps). --images writes each
// picture as <dir>/NN.<ext> and <dir>/images.json ([{ t, file, path }], t in the cast's seconds) for panel.mjs. The
// home folder becomes ~, and a line that looks like a secret (a key, a token, a password) is dropped.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
// the transcript holds each picture as base64 text: decoded through the engine's one codec (G649)
import { base64Bytes } from '../../src/shared/engine/core/byteCodec.ts';

/** beats (s) per kind of line */
export const BEAT = { text: 0.9, tool: 0.45, result: 0.25, image: 0.9 };
const SECRET = /\b(wsk_|sk-|ghp_|gho_|xox[bp]-|AKIA)[A-Za-z0-9]|(api[_-]?key|token|secret|password)\s*[:=]\s*\S{8,}/i;
const ESC = '\u001B[';
const C = { dot: `${ESC}38;5;114m⏺${ESC}0m`, text: `${ESC}97m⏺${ESC}0m`, bold: (s) => `${ESC}1m${s}${ESC}22m`, dim: (s) => `${ESC}2m${s}${ESC}0m` };

/** one tool call as Claude Code prints it: Name(the argument that says what it does) @param {{ name: string, input: any }} t */
export function toolLine(t, compact = false) {
  const i = t.input ?? {};
  const arg = i.command ?? i.file_path ?? i.pattern ?? i.path ?? i.url ?? i.description ?? '';
  const name = { Write: 'Write', Edit: 'Update', Read: 'Read', Bash: 'Bash' }[t.name] ?? t.name;
  let line = String(arg).split('\n')[0];
  // compact: a path is its file name; a command is its last step after any `cd … &&`, three words at most
  if (compact) line = i.command === undefined ? line.split('/').at(-1) ?? line : (line.split('&&').at(-1) ?? line).trim().split(/\s+/u).slice(0, 3).join(' ');
  return `${name}(${line})`;
}

/** compact: the tool calls a viewer reads as building (writing a file, looking at a capture, the SDK's build and check, a
 * commit), not the reading around them */
export const SHOWN = /^(Write|Update|Read)\(|^Bash\((npx wildshard|pnpm|git (commit|push)|node scripts\/(look|trailer|shoot))/u;

/** compact text: the first sentence (or line) of Claude's words @param {string} s */
export const firstSentence = (s) => { const l = s.trim().split('\n')[0]; const m = /^.*?[.!?](?=\s|$)/u.exec(l); return (m ? m[0] : l).trim(); };

/** @param {string} s @param {string} home */
const clean = (s, home) => s.toWellFormed().replaceAll(home, '~').replaceAll('\t', '  ');

/**
 * The cast's events from a transcript's lines. @param {string} text the .jsonl
 * @param {{ from?: string, to?: string, cols?: number, home?: string, compact?: boolean, ask?: string, prose?: boolean, match?: RegExp, pictures?: RegExp }} [o]
 * @returns {{ events: [number, 'o', string][], images: { t: number, media: string, data: string, path: string }[], length: number }}
 */
export function replay(text, o = {}) {
  const cols = o.cols ?? 96, home = o.home ?? homedir(), compact = o.compact === true;
  const fit = (/** @type {string} */ s, /** @type {number} */ pad) => { const w = cols - pad, cp = Array.from(s); return cp.length > w ? `${cp.slice(0, w - 1).join('')}…` : s; };
  /** @type {[number, 'o', string][]} */
  const events = [];
  const images = [];
  /** @type {Map<string, string>} tool_use id → its file path (a Read's picture) */
  const reads = new Map();
  let t = 0;
  if (compact) events.push([0, 'o', `${ESC}?25l`]); // compact: no cursor
  const put = (/** @type {string} */ s, /** @type {number} */ beat) => { t += beat; events.push([Number(t.toFixed(3)), 'o', s]); };
  const lines = (/** @type {string} */ s) => clean(s, home).split('\n').filter((l) => !SECRET.test(l));
  if (o.ask !== undefined) {
    const brief = firstPrompt(text);
    if (!brief.includes(o.ask)) throw new Error(`transcript-cast: --ask is not in the session's first prompt: ${o.ask}`);
    put(`\r\n${C.bold(wrap(`> ${o.ask}`, cols, '  '))}\r\n`, 0.1); // up at once: a beat never opens on an empty terminal
  }
  /** compact text: the first matching line (--match), else the first line; said1 keeps one sentence (the matching one) */
  const said = (/** @type {string} */ s) => (o.match ? lines(s.trim()).map((l) => l.replace(/^[\s*>-]+/u, '').replaceAll('**', '').trim()).find((l) => o.match?.test(l)) : lines(s)[0]);
  const said1 = (/** @type {string} */ s) => {
    const l = said(o.match ? s : firstSentence(s));
    if (l === undefined) return undefined;
    return (o.match ? l.split(/(?<=[.!?])\s+/u).find((x) => o.match?.test(x)) : undefined) ?? firstSentence(l);
  };
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    const clock = String(d.timestamp ?? '').slice(11, 19);
    if (!clock || (o.from && clock < o.from) || (o.to && clock > o.to)) continue;
    const content = d.message?.content;
    if (d.type === 'assistant' && Array.isArray(content)) {
      for (const x of content) {
        if (x.type === 'text' && x.text.trim()) {
          if (compact) { const l = said1(x.text); if (l) put(`\r\n${C.text} ${wrap(l, cols - 2, '  ')}`, BEAT.text); continue; }
          const body = lines(x.text.trim()).slice(0, 4);
          if (body.length > 0) put(`\r\n${C.text} ${body.map((l) => fit(l, 2)).join('\r\n  ')}\r\n`, BEAT.text);
        } else if (x.type === 'tool_use') {
          if (x.name === 'Read' && x.input?.file_path) reads.set(x.id, clean(x.input.file_path, home));
          if (compact && (o.prose === true || !SHOWN.test(toolLine(x, true)))) continue;
          const line = lines(toolLine(x, compact))[0];
          if (line !== undefined) put(compact ? `\r\n${C.dot} ${C.bold(fit(line, 2))}` : `\r\n${C.dot} ${C.bold(fit(line, 2))}\r\n`, BEAT.tool);
        }
      }
    } else if (d.type === 'user' && Array.isArray(content)) {
      for (const x of content) {
        if (x.type !== 'tool_result') continue;
        const parts = Array.isArray(x.content) ? x.content : [{ type: 'text', text: String(x.content ?? '') }];
        const pic = parts.find((p) => p.type === 'image' && p.source?.data);
        if (pic) {
          if (o.pictures && !o.pictures.test(reads.get(x.tool_use_id) ?? '')) continue;
          images.push({ t: Number((t + BEAT.image).toFixed(3)), media: pic.source.media_type ?? 'image/png', data: pic.source.data, path: reads.get(x.tool_use_id) ?? '' });
          if (o.prose === true) t += BEAT.image; // prose: the panel shows the picture; no line for it
          else put(compact ? `\r\n  ${C.dim('⎿  Read image')}` : `  ${C.dim('⎿  Read image')}\r\n`, BEAT.image);
          continue;
        }
        if (compact) continue;
        const out = lines(parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim()).filter((l) => l.trim());
        if (out.length === 0) continue;
        const shown = out.slice(0, 2).map((l, k) => `${k ? '     ' : '  ⎿  '}${C.dim(fit(l, 5))}`);
        if (out.length > 2) shown.push(`     ${C.dim(`… +${out.length - 2} lines`)}`);
        put(`${shown.join('\r\n')}\r\n`, BEAT.result);
      }
    }
  }
  return { events, images, length: t };
}

/** words wrapped at `cols` (a terminal wraps mid-word), each later row indented @param {string} s @param {number} cols
 * @param {string} indent */
export function wrap(s, cols, indent) {
  const rows = [''];
  for (const w of s.split(' ')) {
    const row = rows.at(-1) ?? '';
    if (row !== '' && Array.from(row).length + 1 + Array.from(w).length > cols) rows.push(indent + w);
    else rows[rows.length - 1] = row === '' ? w : `${row} ${w}`;
  }
  return rows.join('\r\n');
}

/** the session's first prompt (a lane's brief), as text @param {string} text the .jsonl */
export function firstPrompt(text) {
  for (const raw of text.split('\n')) {
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    if (d.type !== 'user') continue;
    const c = d.message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c) && c.some((x) => x.type === 'text')) return c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
  }
  return '';
}

/** a picture's real type from its first bytes (a transcript's media type can be wrong) @param {Buffer} b */
export const sniff = (b) => (b[0] === 0xFF && b[1] === 0xD8 ? 'jpg' : b[0] === 0x89 && b[1] === 0x50 ? 'png' : b.subarray(8, 12).toString() === 'WEBP' ? 'webp' : 'bin');

/** @param {string[]} argv */
export function main(argv) {
  const [IN, OUT] = argv;
  const opt = (/** @type {string} */ k, /** @type {string} */ d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };
  if (!OUT) { console.error('node scripts/trailer/transcript-cast.mjs <session.jsonl> <out.cast> [--from HH:MM] [--to HH:MM] [--images <dir>]'); return 2; }
  const cols = Number(opt('cols', '96')), rows = Number(opt('rows', '30'));
  const re = (/** @type {string} */ k) => (opt(k, '') ? new RegExp(opt(k, ''), 'iu') : undefined);
  const { events, images, length } = replay(readFileSync(IN, 'utf8'), { from: opt('from', '') || undefined, to: opt('to', '') || undefined, cols, compact: argv.includes('--compact'),
    ask: opt('ask', '') || undefined, prose: argv.includes('--prose'), match: re('match'), pictures: re('pictures') });
  const header = { version: 2, width: cols, height: rows, timestamp: 0, env: { TERM: 'xterm-256color' }, theme: { fg: '#d8e6f0', bg: '#050a12', palette: '#050a12:#ff6b6b:#7fd18b:#ffd479:#6cb6ff:#c79bff:#8fe3ff:#d8e6f0:#3b4a5a:#ff8a8a:#9be3a5:#ffe39b:#8fc8ff:#d9b8ff:#b4f0ff:#ffffff' } };
  writeFileSync(OUT, `${[JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join('\n')}\n`);
  const dir = opt('images', '');
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const list = images.map((im, k) => {
      const bytes = Buffer.from(base64Bytes(im.data));
      const file = `${String(k).padStart(2, '0')}.${sniff(bytes)}`;
      writeFileSync(`${dir}/${file}`, bytes);
      return { t: im.t, file, path: im.path };
    });
    writeFileSync(`${dir}/images.json`, JSON.stringify({ length, images: list }, null, 1));
  }
  console.log(`[transcript-cast] ${events.length} lines, ${length.toFixed(1)} s, ${images.length} pictures → ${OUT}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
