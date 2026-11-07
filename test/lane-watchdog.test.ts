import { expect, it } from 'vitest';
import { laneTurnMarkers, latestLaneCommit, observeLaneTurn, releaseCheckDue, type TurnObservation } from '../scripts/lane-watchdog.mjs';

const older = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const newer = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const other = '3333333ccccccccccccccccccccccccccccccccc';
const record = (sha: string, seconds: number, body = '') => `${sha}\0${seconds}\0Jake\0${body}\nAssisted-by: Codex:gpt-6.1-sol\u001E`;
const history = record(other, 300) + record(newer, 200) + record(older, 100);
const ledger = new Map([[older, 'pane-x7']]);

it('credits each lane only for its own verified report despite identical authors and trailers', () => {
  const text = `• LANDED \`${newer.slice(0, 9)}\` — pushed, checks green\n`;
  expect(latestLaneCommit(history, text, 'sp-x7', 'pane-x7', ledger)).toMatchObject({ sha: newer, at: 200_000 });
  expect(latestLaneCommit(history, `PUSHED ${other}`, 'sp-x8', 'pane-x8', ledger)).toMatchObject({ sha: other, at: 300_000 });
  expect(latestLaneCommit(history, '', 'sp-x5', 'pane-x5', ledger)).toBeUndefined();
  // Losing the visible report on the next poll must not fall back to the older ledger entry.
  expect(latestLaneCommit(history, '• Working', 'sp-x7', 'pane-x7', ledger, newer)).toMatchObject({ sha: newer, at: 200_000 });
});

it('rejects uncommitted/ambiguous hashes and incoming peer messages or ordinary mentions', () => {
  const text = `› [from sp-x8] LANDED ${other}\n  LANDED ${other}\n• I verified ${other} on origin\n> PUSHED ${other}\nLANDED deadbeef\n`;
  expect(latestLaneCommit(history, text, 'sp-x7', 'pane-x7', ledger)).toMatchObject({ sha: older });
  const ambiguous = record('2222222ccccccccccccccccccccccccccccccccc', 400) + history;
  expect(latestLaneCommit(ambiguous, 'LANDED 2222222', 'sp-x7', 'pane-x7', ledger)).toMatchObject({ sha: older });
  expect(latestLaneCommit(record(newer, 200, 'Thanks sp-x7 for the help'), '', 'sp-x7', 'pane-x7', new Map())).toBeUndefined();
});

it('credits labelled coordinator reports after the lane pane scrolls into a fresh turn', () => {
  const coordinator = `❯ [from sp-x4] LANDED \`${newer.slice(0, 9)}\`: checks green\n  owner paths clean\n› [from sp-x6] PUSHED ${other}\n[from sp-x1] LANDED\n  ${older}\n`;
  expect(latestLaneCommit(history, '• Starting the next task', 'sp-x4', 'pane-x4', new Map(), '', coordinator)).toMatchObject({ sha: newer });
  expect(latestLaneCommit(history, '', 'sp-x6', 'pane-x6', new Map(), '', coordinator)).toMatchObject({ sha: other });
  expect(latestLaneCommit(history, '', 'sp-x1', 'pane-x1', new Map(), '', coordinator)).toMatchObject({ sha: older });
  expect(latestLaneCommit(history, '', 'sp-x7', 'pane-x7', new Map(), '', coordinator)).toBeUndefined();
  // Once observed, the verified attribution survives both panes scrolling away.
  expect(latestLaneCommit(history, '', 'sp-x4', 'pane-x4', new Map(), newer)).toMatchObject({ sha: newer });
  const invalid = `> [from sp-x4] LANDED ${other}\n  [from sp-x4] PUSHED ${other}\n⏺ Mention [from sp-x4] PUSHED ${other}\n[from sp-x4] LANDED deadbeef\n[from sp-x6] LANDED ${other}\n`;
  expect(latestLaneCommit(history, '', 'sp-x4', 'pane-x4', new Map(), '', invalid)).toBeUndefined();
  const ambiguous = record('2222222ccccccccccccccccccccccccccccccccc', 400) + history;
  expect(latestLaneCommit(ambiguous, '', 'sp-x4', 'pane-x4', new Map(), '', '[from sp-x4] LANDED 2222222')).toBeUndefined();
});

it('resets a continuously working turn once for landing, ending or coordinator start reports', () => {
  const minute = 60_000;
  const overdue: TurnObservation = { since: 0, alerted: true, seen: new Set() };
  const landing = laneTurnMarkers(history, '', 'sp-x4', `[from sp-x4] LANDED ${newer}`);
  const landed = observeLaneTurn(overdue, landing, 61 * minute);
  expect(landed.since).toBe(61 * minute);
  expect(landed.alerted).toBe(false);
  expect(observeLaneTurn(landed, landing, 70 * minute)).toBe(landed);
  expect(observeLaneTurn(landed, [], 80 * minute)).toBe(landed);
  const pushed = laneTurnMarkers(history, `PUSHED ${newer}`, 'sp-x4');
  const published = observeLaneTurn(landed, pushed, 81 * minute);
  expect(published.since).toBe(81 * minute);
  const ending = laneTurnMarkers(history, '• Resources closed. Ending this turn.', 'sp-x4');
  expect(ending).toHaveLength(1);
  const ended = observeLaneTurn(published, ending, 82 * minute);
  expect(ended.since).toBe(82 * minute);
  const prompt = laneTurnMarkers(history, '› [from wildshard-new] Go: start the next turn now.', 'sp-x4');
  expect(prompt).toHaveLength(1);
  const started = observeLaneTurn(ended, prompt, 83 * minute);
  expect(started.since).toBe(83 * minute);
  expect(observeLaneTurn(started, prompt, 140 * minute)).toBe(started);
  expect(laneTurnMarkers(history, '[from wildshard-new] Thanks. New turn (G440): next task.', 'sp-x4')).toHaveLength(1);
  expect(laneTurnMarkers(history, '', 'sp-x4', '[from sp-x4] Own paths clean; ending turn.')).toHaveLength(1);
  expect(laneTurnMarkers(history, `› [from sp-x6] Ending turn\n> Ending turn\n• The report says "ending turn"\n[from sp-x6] Go: next task`, 'sp-x4')).toEqual([]);
  expect(laneTurnMarkers(history, '', 'sp-x4', `[from sp-x6] LANDED ${other}\n[from sp-x4] LANDED deadbeef`)).toEqual([]);
});

it('wakes the release owner every fifteen minutes independent of idle status', () => {
  expect(releaseCheckDue(899_999, 0)).toBe(false);
  expect(releaseCheckDue(900_000, 0)).toBe(true);
  expect(releaseCheckDue(900_001, 900_000)).toBe(false);
});
