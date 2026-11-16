#!/usr/bin/env node
// PreToolUse(Bash) guard, for Claude Code and Codex alike (meta MINI-FLOW MF12, 2026-11-16). Every lane on both
// machines asks GitHub as Jake's one user, so they share one quota of 5,000 API calls an hour. It ran out twice on
// 2026-11-16, and every land waiting on CI stalled until the quota reset. A plain `gh run watch` polls every 3 s, with
// at least two calls a tick: one watcher spends about 2,400 calls an hour. This refuses a GitHub poll faster than once a
// minute and says how to wait properly. Escape hatch: ALLOW_FAST_GH_POLL=1 in the command (J381).
// Bad input prints nothing and exits 0: a hook must never break a session.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readPayload } from './lib/payload.mjs';

/** The slowest poll this guard lets through, in seconds. */
export const MIN_POLL_S = 60;
const UNIT = { '': 1, s: 1, m: 60, h: 3600 };
const GH_POLL = /(?:^|[\s;&|(`])gh\s+(?:run\s+(?:view|list|watch)|api|pr\s+(?:checks|view)|workflow\s+view)\b/u;

/** Seconds in a `sleep` argument such as 30, 1.5m or 2m 10s. @param {string} text */
const seconds = (text) => text.trim().split(/\s+/u).reduce((sum, part) => {
  const [, number = '0', unit = ''] = /^([0-9]*\.?[0-9]+)([smh]?)$/u.exec(part) ?? [];
  return sum + Number(number) * UNIT[/** @type {keyof typeof UNIT} */ (unit)];
}, 0);

/** `gh` as the command word of a segment: after env assignments or a wrapper (timeout 600, nohup), or inside $( ), ( ) or
 * backticks; never a word inside an echo or a message. */
const GH_WORD = '(?:^\\s*(?:\\w+=\\S*\\s+)*(?:(?:timeout\\s+\\S+|nohup|exec|command|time)\\s+)*|[(`]\\s*)gh\\s+';
const RUN_WATCH = new RegExp(`${GH_WORD}run\\s+watch\\b`, 'u');
const PR_CHECKS = new RegExp(`${GH_WORD}pr\\s+checks\\b`, 'u');

/** The interval a watch flag sets, or undefined. @param {string} segment */
const interval = (segment) => {
  const match = /(?:^|\s)(?:-i|--interval)(?:\s+|=)([0-9]+)(?=\s|$)/u.exec(segment);
  return match === null ? undefined : Number(match[1]);
};

/**
 * Why a shell command polls GitHub too fast, or null when it does not.
 * @param {string} command @returns {string | null}
 */
export function fastPoll(command) {
  if (/(?:^|\s)ALLOW_FAST_GH_POLL=1(?:\s|$)/u.test(command)) return null;
  for (const segment of command.split(/[;&|\n]+/u)) {
    if (RUN_WATCH.test(segment)) {
      const every = interval(segment);
      if (every === undefined) return '`gh run watch` with no --interval polls every 3 s';
      if (every < MIN_POLL_S) return `\`gh run watch --interval ${every}\` polls faster than every ${MIN_POLL_S} s`;
    }
    if (PR_CHECKS.test(segment) && /\s--watch\b/u.test(segment)) {
      const every = interval(segment);
      if (every === undefined) return '`gh pr checks --watch` with no --interval polls every 10 s';
      if (every < MIN_POLL_S) return `\`gh pr checks --watch --interval ${every}\` polls faster than every ${MIN_POLL_S} s`;
    }
  }
  const loop = /(?:^|[\s;&|(`])(?:while|until|for)\s([\s\S]*?)\bdone\b/gu;
  for (const match of command.matchAll(loop)) {
    const body = match[1];
    if (!GH_POLL.test(body)) continue;
    for (const sleep of body.matchAll(/(?:^|[\s;&|(`])sleep\s+((?:[0-9]*\.?[0-9]+[smh]?\s*)+)/gu)) {
      if (seconds(sleep[1]) < MIN_POLL_S) return `a loop calls gh and sleeps ${sleep[1].trim()}, under ${MIN_POLL_S} s`;
    }
  }
  return null;
}

/** The refusal text: what happened, how to wait properly, and the escape hatch. @param {string} reason */
export function refusal(reason) {
  return [
    `BLOCKED by .agents/hooks/gh-poll-guard.mjs: ${reason}.`,
    '',
    "Every lane on the MacBook and the Mac mini shares one GitHub quota (5,000 calls an hour); a fast poll stalls",
    "everyone's land when it runs out (twice on 2026-11-16). Wait properly instead:",
    '  - a plan branch: let `node scripts/land.mjs` wait on its CI (it polls once a minute and waits out a spent quota);',
    '  - one run: `gh run watch <id> -R <repo> --exit-status --interval 60`, as a background run;',
    '  - a loop: one `gh run list` or `gh run view` per pass and `sleep 60` or more, stopping when the run completes.',
    'Escape hatch, when a faster poll is truly needed: put ALLOW_FAST_GH_POLL=1 in front of the command.',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  const { tool, command } = readPayload(raw);
  const reason = tool === 'shell' ? fastPoll(command) : null;
  if (reason !== null) {
    process.stderr.write(`${refusal(reason)}\n`);
    process.exit(2);
  }
}
