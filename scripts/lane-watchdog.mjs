#!/usr/bin/env node
// G418: poll once per 60s; ONLY notify wildshard-new through herdr-prompt.sh.
// Herdr exposes status but no reliable status-start timestamp/completion_seq in
// agent list. Durations therefore start at this process's first observation of
// each idle/done or working episode, not at guessed historical activity.
// Commit attribution also reads labelled [from sp-xN] reports in wildshard-new's
// pane. Own and coordinator LANDED/PUSHED SHAs must resolve in git log.
// A short SHA must resolve uniquely in git log; retain a verified report after
// it scrolls out of view. Read visible text while working, recent text at idle.
// Exact commit-lanes.jsonl pane records and explicit lane trailers still count;
// generic Jake/Assisted-by identities never identify a lane. A new attributed
// commit resets the working/no-commit clock. Landing, ending-turn and incoming
// coordinator New turn/Go: markers also reset the observed turn timer once,
// including fast restarts that remain continuously working between polls.
// Visible markers are deduplicated, not fresh activity on every poll.
// One successful alert per condition;
// state changes, session replacement or a new commit re-arm it. No AI process.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import * as v from 'valibot';
import { gitCommonPath } from './git-common.mjs';

const root = resolve(import.meta.dirname, '..');
const agentsSchema = v.object({ result: v.object({ agents: v.array(v.object({
  name: v.optional(v.string()), pane_id: v.string(), agent_status: v.string(),
  agent_session: v.optional(v.object({ value: v.string() })),
})) }) });
const commitSchema = v.object({ sha: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/u)), pane: v.string() });
/** @typedef {{ since: number, alerted: boolean, seen: ReadonlySet<string> }} TurnObservation */
/** @typedef {{ identity: string, status: string, since: number, commit: string, changed: number, alerted: boolean, turn: TurnObservation, nudged?: number, nudges?: number }} Observation */
/** @type {Map<string, Observation>} */
const observations = new Map();
const stop = new AbortController();
let releaseCheckedAt = Date.now();

/** @param {string} history */
function gitCommits(history) {
  return history.split('\u001E').flatMap(record => {
    const fields = record.trim().split('\0');
    if (fields.length < 4) return [];
    const [sha, seconds, author, body] = fields;
    const at = Number(seconds) * 1000;
    return /^[a-f0-9]{40}$/u.test(sha) && Number.isFinite(at) ? [{ sha, at, author, body }] : [];
  });
}

/** Only labelled incoming messages, never shell commands or quoted examples.
 * Includes Claude/Codex prompt glyphs and indented wrapped message lines.
 * @param {string} text */
function incomingMessages(text) {
  return [...text.matchAll(/^(?:[ \t]*[❯›][ \t]+)?\[from (sp-[xo]\d+|wildshard-new)\][ \t]+([^\n]*(?:\n(?![ \t]*\[from )[ \t]{2,}[^\n]+)*)/gmu)]
    .map(match => ({ sender: match.at(1), body: (match.at(2) ?? '').replaceAll(/\s+/gu, ' ').trim() }));
}

/** @param {ReturnType<typeof gitCommits>} commits @param {string} text
 * @param {string} name @param {string} coordinatorText */
function verifiedReports(commits, text, name, coordinatorText) {
  const own = [...text.matchAll(/^(?:[ \t]*[•●⏺][ \t]+)?(LANDED|PUSHED)[ \t]+`?([a-f0-9]{7,40})\b/gmu)]
    .map(match => ({ verb: match.at(1), prefix: match.at(2) }));
  const coordinator = incomingMessages(coordinatorText).filter(message => message.sender === name).flatMap(message => {
    const match = /^(LANDED|PUSHED)[ \t]+`?([a-f0-9]{7,40})\b/u.exec(message.body);
    return match === null ? [] : [{ verb: match.at(1), prefix: match.at(2) }];
  });
  return [...own, ...coordinator].flatMap(report => {
    const prefix = report.prefix;
    if (prefix === undefined) return [];
    const matching = commits.filter(commit => commit.sha.startsWith(prefix));
    const commit = matching.at(0);
    return matching.length === 1 && commit !== undefined ? [{ verb: report.verb, commit }] : [];
  });
}

/** Match own standalone reports and coordinator messages explicitly sent by this lane.
 * A short SHA must resolve uniquely in history; previous verified reports survive scrolling.
 * @param {string} history @param {string} text @param {string} name
 * @param {string} pane @param {ReadonlyMap<string, string>} ledger
 * @param {string} [previous] @param {string} [coordinatorText]
 * @returns {{sha: string, at: number} | undefined} */
export function latestLaneCommit(history, text, name, pane, ledger, previous = '', coordinatorText = '') {
  const commits = gitCommits(history);
  const reported = new Set([previous, ...verifiedReports(commits, text, name, coordinatorText).map(report => report.commit.sha)]);
  return commits.find(commit => {
    const explicit = [commit.author, ...commit.body.split('\n').filter(line => /^(?:Assisted-by|Lane|Agent):/u.test(line))];
    return reported.has(commit.sha) || ledger.get(commit.sha) === pane
      || explicit.some(line => line.match(/\bsp-[xo]\d+\b/gu)?.includes(name));
  });
}

/** Observed turn boundaries, not guessed Herdr timestamps. Commit reports are git-verified;
 * other boundaries require an own ending line or an explicit coordinator prompt.
 * @param {string} history @param {string} text @param {string} name @param {string} [coordinatorText] */
export function laneTurnMarkers(history, text, name, coordinatorText = '') {
  const markers = verifiedReports(gitCommits(history), text, name, coordinatorText).map(report => `${report.verb}:${report.commit.sha}`);
  for (const match of text.matchAll(/^(?:[ \t]*[•●⏺][ \t]+(.+)|((?:Ending(?: this| the)? turn|Turn ended)\b.*))$/gimu)) {
    const body = match.at(1) ?? match.at(2) ?? '';
    if (/(?:^|[.!?]\s+)(?:ending(?: this| the)? turn|turn ended)\b/iu.test(body)) markers.push(`end:${body.trim()}`);
  }
  for (const message of incomingMessages(coordinatorText)) {
    if (message.sender === name && /\b(?:ending(?: this| the)? turn|turn ended)\b/iu.test(message.body)) markers.push(`end:${message.body}`);
  }
  for (const message of incomingMessages(text)) {
    if (message.sender === 'wildshard-new' && /(?:^|[.!?]\s+)(?:new turn\b|go:)/iu.test(message.body)) markers.push(`prompt:${message.body}`);
  }
  return [...new Set(markers)];
}

/** Consume a boundary once; leaving it visible never postpones the next alert.
 * Retain visible markers and at most 512 recent others per working episode.
 * @param {TurnObservation} turn @param {readonly string[]} markers @param {number} now
 * @returns {TurnObservation} */
export function observeLaneTurn(turn, markers, now) {
  if (markers.every(marker => turn.seen.has(marker))) return turn;
  const seen = new Set([...turn.seen, ...markers]);
  for (const marker of seen) {
    if (seen.size <= 512) break;
    if (!markers.includes(marker)) seen.delete(marker);
  }
  return { since: now, alerted: false, seen };
}

/** The callback adapter deliberately returns void; the child handle is not a completion signal.
 * @param {string} executable @param {string[]} args
 * @param {(error: Error | null, stdout: string, stderr: string) => void} complete */
function execute(executable, args, complete) {
  execFile(executable, args, { cwd: root, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, complete);
}
const command = promisify(execute);

/** sp-ci-deploy is exempt from idle/commit nags, but actively checks releases every 15 min.
 * @param {number} now @param {number} last */
export function releaseCheckDue(now, last) { return now - last >= 15 * 60_000; }

async function poll() {
  const [listed, history, ledger] = await Promise.all([
    command('herdr', ['agent', 'list']),
    command('git', ['log', '--since=2 hours ago', '-512', '--format=%H%x00%ct%x00%an%x00%B%x1e']),
    readFile(gitCommonPath('commit-lanes.jsonl', root), 'utf8').catch((/** @type {unknown} */ error) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    }),
  ]);
  const agents = v.parse(agentsSchema, JSON.parse(listed)).result.agents;
  const laneAgents = agents.filter(agent => agent.name !== undefined && /^sp-[xo]\d+$/u.test(agent.name));
  /** @type {Map<string, string | undefined>} */
  const texts = new Map();
  const coordinator = agents.find(agent => agent.name === 'wildshard-new');
  const readers = coordinator === undefined ? laneAgents : [...laneAgents, coordinator];
  await Promise.all(readers.map(async agent => {
    const source = agent.agent_status === 'idle' || agent.agent_status === 'done' ? 'recent-unwrapped' : 'visible';
    try {
      texts.set(agent.pane_id, await command('herdr', ['agent', 'read', agent.pane_id, '--source', source, '--lines', '200']));
    } catch {
      // The agent may start working between list and read; never scroll it then.
      try { texts.set(agent.pane_id, await command('herdr', ['agent', 'read', agent.pane_id, '--source', 'visible', '--lines', '200'])); }
      catch { texts.set(agent.pane_id, undefined); }
    }
  }));
  const coordinatorText = coordinator === undefined ? '' : texts.get(coordinator.pane_id) ?? '';
  const panes = new Map();
  for (const line of ledger.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = v.safeParse(commitSchema, JSON.parse(line));
      if (parsed.success) panes.set(parsed.output.sha, parsed.output.pane);
    } catch { /* Partial concurrent ledger append supplies no attribution. */ }
  }
  const EXEMPT = new Set(['sp-x7', 'sp-x10']);
  const now = Date.now(), live = new Set();
  if (releaseCheckDue(now, releaseCheckedAt) && agents.some(agent => agent.name === 'sp-ci-deploy')) {
    try {
      await command('bash', ['scripts/herdr-prompt.sh', 'sp-ci-deploy',
        '[watchdog release check] Check CI, smoke and live now; fix or route reds and report the verdict.']);
      releaseCheckedAt = now;
    } catch { /* The question guard refused; retry on the next observation. */ }
  }

  for (const agent of agents) {
    const name = agent.name;
    // sp-ci-deploy (was sp-x7, G802) is the release watcher (G485) and idles between events by design; its
    // name never matches the lane pattern. sp-x7 and sp-x10 are retired names. Every Opus lane takes rows.
    if (name === undefined || !/^sp-[xo]\d+$/u.test(name) || EXEMPT.has(name)) continue;
    live.add(name);
    const identity = `${agent.pane_id}:${agent.agent_session?.value ?? ''}`;
    const status = agent.agent_status === 'idle' || agent.agent_status === 'done' ? 'idle/done' : agent.agent_status;
    let observed = observations.get(name);
    if (observed === undefined || observed.identity !== identity || observed.status !== status) {
      observed = { identity, status, since: now, commit: '', changed: now, alerted: false, turn: { since: now, alerted: false, seen: new Set() } };
      observations.set(name, observed);
    }
    const text = texts.get(agent.pane_id);
    const commit = latestLaneCommit(history, text ?? '', name, agent.pane_id, panes, observed.commit, coordinatorText);
    if (commit !== undefined && observed.commit !== commit.sha) {
      observed.commit = commit.sha;
      observed.changed = Math.max(observed.since, Math.min(now, commit.at));
      if (status === 'working') observed.alerted = false;
      observed.turn = { since: now, alerted: false, seen: new Set() };
    }
    observed.turn = observeLaneTurn(observed.turn, laneTurnMarkers(history, text ?? '', name, coordinatorText), now);
    // A failed own-pane read cannot establish that no new-turn prompt arrived.
    if (status === 'working' && text === undefined) continue;
    // G440: reports/prompts split turns even when status remains continuously working.
    const turn = now - observed.turn.since;
    if (status === 'working' && turn > 60 * 60_000 && !observed.turn.alerted) {
      const message = `[watchdog] ${name} one turn has run ${Math.floor(turn / 60_000)} min (G440: one task per turn). Wrap it at its next commit and start the next task in a fresh turn.`;
      await command('bash', ['scripts/herdr-prompt.sh', 'wildshard-new', message]);
      observed.turn.alerted = true;
      console.info(`${new Date().toISOString()} ${message}`);
    }
    const age = now - (status === 'working' ? observed.changed : observed.since);
    // G569: an idle lane is nudged itself after 3 min, background shells or not, then every 10 min
    // while it stays idle; the coordinator hears only after two nudges went unanswered.
    if (status === 'idle/done') {
      if (age < 3 * 60_000 || now - (observed.nudged ?? 0) < 10 * 60_000) continue;
      const nudge = '[watchdog] idle: take your next open row now (your live plan in docs/plans/; download reviews: docs/plans/download/STATE.md); don\'t wait for a reply. If your own check is still running, start the next row meanwhile.';
      try { await command('bash', ['scripts/herdr-prompt.sh', name, nudge]); }
      catch { continue; } // herdr-prompt.sh refuses while the lane has a question open.
      observed.nudged = now;
      observed.nudges = (observed.nudges ?? 0) + 1;
      console.info(`${new Date().toISOString()} nudged ${name} (idle ${Math.floor(age / 60_000)} min)`);
      if (observed.nudges >= 3 && !observed.alerted) {
        const message = `[watchdog] ${name} still idle after ${observed.nudges - 1} nudges (${Math.floor(age / 60_000)} min, pane ${agent.pane_id}): it may have no open row.`;
        await command('bash', ['scripts/herdr-prompt.sh', 'wildshard-new', message]);
        observed.alerted = true;
      }
      continue;
    }
    if (status !== 'working' || age <= 45 * 60_000 || observed.alerted) continue;
    const minutes = Math.floor(age / 60_000);
    const message = `[watchdog] ${name} working for ${minutes} min without an attributed commit (own/coordinator LANDED/PUSHED report verified in git log, exact pane ledger or lane trailer; last ${observed.commit.slice(0, 9) || 'none observed'}). Split or redirect its task.`;
    await command('bash', ['scripts/herdr-prompt.sh', 'wildshard-new', message]);
    observed.alerted = true;
    console.info(`${new Date().toISOString()} ${message}`);
  }
  for (const name of observations.keys()) if (!live.has(name)) observations.delete(name);
}

async function main() {
  if (process.env.HERDR_ENV !== '1') throw new Error('lane-watchdog requires a Herdr-managed terminal');
  process.once('SIGINT', () => { stop.abort(); });
  process.once('SIGTERM', () => { stop.abort(); });
  console.info('lane-watchdog: 60s poll; idle lanes nudged at 3 min then every 10 min (G569); 45min no-commit / 60min turn alert wildshard-new');
  while (!stop.signal.aborted) {
    const started = Date.now();
    try { await poll(); }
    catch (error) { console.error('lane-watchdog: observation/send refused:', error instanceof Error ? error.message : String(error)); }
    try { await setTimeout(Math.max(1, 60_000 - (Date.now() - started)), undefined, { signal: stop.signal }); }
    catch (error) { if (!(error instanceof Error) || error.name !== 'AbortError') throw error; }
  }
  console.info('lane-watchdog: stopped');
}

const entry = process.argv.at(1);
if (entry !== undefined && resolve(entry) === import.meta.filename) await main();
