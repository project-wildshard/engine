// Registered by test/main-watch.test.ts in the engine CI suite.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { attribute, failurePaths, KEEPER_MS, landers, liveIo, memoryQaCall, readState, redMessage, redRecipients, redSuspect, shouldPromptRed, sweep } from '../main-watch.mjs';

const older = 'a'.repeat(40), newer = 'b'.repeat(40), other = 'c'.repeat(40);
const testFile = 'test/host-ruler-roots.test.ts', sourceFile = 'src/scripts/host-ruler/roots.mjs';
const range = 'old..new', url = 'https://github.com/project-wildshard/engine/actions/runs/49', failed = 'tests (6)';

test('J473 groups commits and a named fixer at one physical pane', () => {
  const rows = [
    { sha: newer, lander: { lane: 'codex-fix', slug: '', pane: 'w1:p1' } },
    { sha: older, lander: { lane: 'opus-plan', slug: 'fix-plan' } },
    { sha: older, lander: { lane: 'opus-plan', slug: 'fix-plan' } },
    { sha: other, lander: { lane: 'other', slug: '', pane: 'w1:p2' } },
  ];
  const recipients = redRecipients(rows, [{ pane_id: 'w1:p1', label: 'engine plan/fix-plan' }],
    new Map([['coordinator', 'w1:p1']]), ['coordinator', 'coordinator']);
  expect(recipients.map(row => [row.key, [...row.commits], row.fixer])).toEqual([
    ['pane:w1:p1', [newer, older], true], ['pane:w1:p2', [other], false],
  ]);
  const text = redMessage(recipients[0], {
    range, url, failed, named: 'codex-fix, opus-plan, other', suspect: { sha: older, file: testFile },
  });
  expect(text).toMatch(/^main-watch: MAIN RED\. Suspect aaaaaaaaaa \(yours\) last changed test\/host-ruler-roots\.test\.ts/u);
  expect(text).toContain('You also landed bbbbbbbbbb');
  expect(text.match(/aaaaaaaaaa/gu)).toHaveLength(1);
  expect(text).not.toContain('cccccccccc');
});

test('J473 takes failure evidence from colored logs and picks the newest matching change in the range', () => {
  const logs = [
    `2026-11-19T22:34:03.8257769Z ✓ node test/passed.test.ts\n`
      + `2026-11-19T22:34:03.8259339Z \u001B[41m FAIL \u001B[0m node /home/runner/work/engine/engine/${testFile} > title\n`
      + `2026-11-19T22:34:03.8264015Z ❯ ${testFile}:45:47\n`,
    `##[error]${sourceFile}(9,1): error TS2322: bad type\n`,
  ];
  const files = failurePaths(logs);
  expect(files).toEqual([`home/runner/work/engine/engine/${testFile}`, testFile, sourceFile]);
  expect(redSuspect([other, newer, older], files, new Map([
    [other, ['test/passed.test.ts']], [newer, [sourceFile]], [older, [testFile]],
  ]))).toEqual({ sha: newer, file: sourceFile });
  expect(redSuspect([other, older], files, new Map([[older, [testFile]]]))).toEqual({ sha: older, file: testFile });
  expect(redSuspect([other], files, new Map([[other, ['test/passed.test.ts']]]))).toBeUndefined();
});

test('J473 remembers a delivered run across a rerun, a replay and the keeper tick', () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const scratch = mkdtempSync(resolve('tmp/main-watch-dedupe-'));
  const state = join(scratch, 'state.json');
  try {
    const green = { id: 48, created_at: '2026-11-19T22:00:00Z', head_sha: other, status: 'completed', conclusion: 'success', event: 'push' };
    const red = { ...green, id: 49, created_at: '2026-11-19T22:01:00Z', head_sha: newer, conclusion: 'failure' };
    let runs = [green], now = Date.parse(red.created_at);
    /** @type {string[]} */ const sent = [];
    /** @type {Parameters<typeof sweep>[0]} */ const io = {
      repo: 'project-wildshard/engine', state, runs: () => runs, tip: () => newer, contains: () => true,
      failed: () => ({ names: [failed], logs: [`FAIL ${testFile} > section host`] }), annotations: () => '',
      commits: () => [newer, older], changes: () => new Map([[older, [testFile]]]),
      receipts: () => `17:01 Cancún codex-fix main-push pushed main bbbbbbbbbb: 2 commit(s) pane w2:p5`,
      receipt: () => undefined, now: () => now, fixers: () => ['coordinator'], panes: () => [],
      agents: () => new Map([['coordinator', 'w2:p5']]),
      send: (_pane, text) => { sent.push(text); return true; },
      prompt: (_lane, text) => { sent.push(text); return true; },
      dispatch: () => undefined, quotaReset: () => now,
    };
    sweep(io);
    runs = [green, red]; sweep(io);
    expect(sent).toEqual([expect.stringContaining('Suspect aaaaaaaaaa')]);
    runs = [green, { ...red, run_attempt: 2 }]; sweep(io);
    const saved = readState(state);
    expect(saved?.notified?.[red.id]).toContain('pane:w2:p5');
    // judged is bounded. Replay after a lost/aged-out verdict and still preserve per-recipient delivery history.
    writeFileSync(state, JSON.stringify({ ...saved, judged: [green.id], red: { ...saved?.red, keeper: false } }));
    sweep(io);
    now += KEEPER_MS + 1;
    sweep(io);
    expect(sent).toHaveLength(1);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

const freshFile = 'test/spawn-cell.test.ts', incoming = 'd'.repeat(40);

/** @param {(fixture:ReturnType<typeof redSpanFixture>)=>void} verify */
function withRedSpan(verify) {
  mkdirSync(resolve('tmp'), { recursive: true });
  const scratch = mkdtempSync(resolve('tmp/main-watch-span-'));
  try { verify(redSpanFixture(join(scratch, 'state.json'))); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** @param {string} state */
function redSpanFixture(state) {
  const green = { id: 60, created_at: '2026-11-19T22:00:00Z', head_sha: other, status: 'completed', conclusion: 'success', event: 'push' };
  const runs = [green], logs = new Map();
  /** @type {{to:string,text:string}[]} */ const sent = [];
  /** @type {string[]} */ const receipts = [];
  /** @type {Parameters<typeof sweep>[0]} */ const io = {
    repo: 'project-wildshard/engine', state, runs: () => runs, tip: () => runs.at(-1)?.head_sha ?? other, contains: () => true,
    failed: id => ({ names: [failed], logs: logs.get(id) ?? [] }), annotations: () => '',
    commits: (_from, to) => to === incoming ? [incoming, newer, older] : [newer, older],
    changes: () => new Map([[newer, [testFile]], [older, [freshFile]]]),
    receipts: () => [
      '17:01 Cancún first main-push pushed main bbbbbbbbbb: 1 commit(s) pane w1:p1',
      '17:02 Cancún second main-push pushed main aaaaaaaaaa: 1 commit(s) pane w1:p2',
      '17:03 Cancún incoming main-push pushed main dddddddddd: 1 commit(s) pane w1:p3',
    ].join('\n'),
    receipt: line => { receipts.push(line); }, panes: () => [], now: () => Date.parse(green.created_at),
    agents: () => new Map(), fixers: () => ['coordinator'],
    send: (to, text) => { sent.push({ to, text }); return true; },
    prompt: (to, text) => { sent.push({ to, text }); return true; }, dispatch: () => undefined,
  };
  /** @param {number} id @param {string[]} paths @param {string} [head] */
  const red = (id, paths, head = newer) => {
    logs.set(id, paths.map(path => `FAIL ${path} > proof`));
    runs.push({ ...green, id, head_sha: head, conclusion: 'failure' });
    sweep(io);
  };
  sweep(io);
  red(61, [`/home/runner/work/engine/engine/${testFile}`]);
  expect(sent.map(row => row.to)).toEqual(['w1:p1', 'w1:p2', 'coordinator']);
  sent.length = 0;
  return { red, runs, green, io, sent, receipts };
}

test('build-max A5: a repeat red with the same commits and failing test is "main still red", never MAIN RED', () => withRedSpan(({ red, sent, receipts }) => {
  red(62, [testFile]);
  expect(sent).toEqual([]);
  expect(receipts).toContainEqual(expect.stringMatching(/^main still red .* run 62: no new failures; failed: /u));
  expect(receipts.filter(line => line.startsWith('MAIN RED') && line.includes('run 62'))).toEqual([]);
}));

test('a newly failing file prompts just its suspect lander and omits the earlier failure', () => withRedSpan(({ red, sent }) => {
  red(62, [testFile, freshFile]);
  expect(sent.map(row => row.to)).toEqual(['w1:p2']);
  expect(sent[0]?.text).toContain(`Suspect aaaaaaaaaa (yours) last changed ${freshFile}`);
  expect(sent[0]?.text).toContain(`failed: ${freshFile}.`);
  expect(sent[0]?.text).not.toContain(testFile);
  sent.length = 0;
  red(63, [testFile]);
  red(64, [freshFile]);
  expect(sent).toEqual([]);
}));

test('build-max A5: a new lander whose run fails only what already failed is not prompted; a green ends the span', () => withRedSpan(({ red, runs, green, io, sent, receipts }) => {
  // Seven of 2026-11-20's alerts were this: a new push into a red span, its run failing nothing new.
  red(62, [testFile], incoming);
  expect(sent).toEqual([]);
  expect(receipts).toContainEqual(expect.stringMatching(/^main still red .* run 62: no new failures/u));
  red(63, [testFile, freshFile], incoming);
  expect(sent.map(row => row.to).sort()).toEqual(['w1:p2', 'w1:p3']);
  expect(sent.find(row => row.to === 'w1:p3')?.text).toContain('You landed dddddddddd');
  sent.length = 0;
  red(64, [testFile, freshFile], incoming);
  expect(sent).toEqual([]);
  runs.push({ ...green, id: 65, head_sha: incoming });
  sweep(io);
  red(66, [testFile]);
  expect(sent.map(row => row.to)).toEqual(['w1:p1', 'w1:p2', 'coordinator']);
}));

test('a running span keeps its prior prompts after a watcher upgrade', () => withRedSpan(({ red, io, sent }) => {
  const saved = readState(io.state);
  if (saved?.red === undefined) throw new Error('expected an open red span');
  delete saved.red.history;
  writeFileSync(io.state, JSON.stringify(saved));
  red(62, [testFile]);
  expect(sent).toEqual([]);
  expect(readState(io.state)?.red?.history?.files).toEqual([testFile]);
}));


test('MD8 replays the two MacBook reds without prompting a mini lane; exact run claims only', () => {
  const localLanes=new Set(['codex-tc48']);
  const scope={machine:'mini',run:44890926808,commits:[newer],recipientLanes:['codex-tc48'],localLanes,receipts:'',trailers:new Map([[newer,['codex-ci21']]])};
  expect(shouldPromptRed(scope)).toBe(false);
  expect(shouldPromptRed({...scope,run:44910588755,trailers:new Map([[newer,['opus-nalati']]])})).toBe(false);
  const mine={...scope,trailers:new Map([[newer,['codex-tc48']]])};
  expect(shouldPromptRed(mine)).toBe(true);
  for(const receipt of [
    '05:35 Cancún NOTE coordinator(mini): MAIN RED run 44890926808 is not mini code; routed to the MacBook.',
    '09:02 Cancún CLAIM MacBook opus-nalati owns run44890926808',
  ])expect(shouldPromptRed({...mine,receipts:receipt})).toBe(false);
  expect(shouldPromptRed({...mine,receipts:'CLAIM MacBook owns run448909268080'})).toBe(true);
  expect(shouldPromptRed({...mine,receipts:'NOTE MacBook owns run44910588755'})).toBe(true);
  expect(shouldPromptRed({...mine,recipientLanes:['opus-nalati']})).toBe(false);
});

test('MD8 claimed MacBook-landed red still prompts its lander through sweep', () => withRedSpan(({red,io,sent})=>{
  io.redAllowed=(run,commits,recipientLanes)=>shouldPromptRed({machine:'macbook',run,commits,recipientLanes,
    localLanes:new Set(),receipts:`14:13 Cancún CLAIM MacBook first owns run${run}`,trailers:new Map()});
  red(62,[testFile,freshFile]);
  expect(sent.map(row=>row.to)).toEqual(['w1:p2']);
}));

test('MD8 mini suppression also covers fallback and keeper; verdict stays red', () => withRedSpan(({red,io,sent,receipts})=>{
  io.redAllowed=()=>false;
  red(62,[testFile,freshFile]);
  io.now=()=>Date.now()+KEEPER_MS;
  sweep(io);
  expect(sent).toEqual([]);
  expect(receipts).toContainEqual(expect.stringMatching(/^MAIN RED .*run 62/u));
}));


test('MD8 a mini-landed red still prompts its mini lander through sweep', () => withRedSpan(({red,io,sent})=>{
  io.redAllowed=(run,commits,recipientLanes)=>shouldPromptRed({machine:'mini',run,commits,recipientLanes,
    localLanes:new Set(['first','second','coordinator']),receipts:'',trailers:new Map([[older,['second']]])});
  red(62,[testFile,freshFile]);
  expect(sent.map(row=>row.to)).toEqual(['w1:p2']);
}));

test('MD9 sweep persists observations, processes newest-first API runs in order, and queues only confirmed/hard misses', () => withRedSpan(({io,receipts})=>{
  const base={status:'completed',event:'push',conclusion:'failure'};
  const line='BUDGET regressed key=ledger/made-up-valley/control measured=41767511 baseline=34715334 line=38186867 contentKey=ink@7';
  const budgetRuns=[],qa=[];
  io.budgetRuns=()=>budgetRuns;
  io.budgetAnnotations=(id)=>id===111?line.replace('regressed','over-hard'):line;
  io.memoryQa=(rows)=>{qa.push(...rows);};
  const add=(id,sha,conclusion='failure')=>budgetRuns.unshift({...base,id,head_sha:sha,created_at:`2026-11-21T19:${String(id-100).padStart(2,'0')}:00Z`,conclusion});
  add(101,newer); sweep(io);
  expect(qa).toEqual([]);
  expect(readState(io.state)?.budgetPending?.['ledger/made-up-valley/control']?.sha).toBe(newer);
  add(102,newer); sweep(io); expect(qa).toEqual([]);
  add(103,older); sweep(io); expect(qa).toHaveLength(1);
  expect(qa[0]?.id).toBe(103);
  add(104,other,'success'); sweep(io);
  add(105,incoming); sweep(io); expect(qa).toHaveLength(1);
  // Multiple unjudged API entries arrive newest first: green 106 resets,
  // 107 is a quiet first miss, 108 confirms it on another SHA.
  add(106,other,'success'); add(107,newer); add(108,older); sweep(io);
  expect(qa.map(row=>row.id)).toEqual([103,108]);
  add(110,other,'success'); add(111,incoming); sweep(io);
  expect(qa.map(row=>row.id)).toEqual([103,108,111]);
  expect(receipts.filter(entry=>entry.startsWith('main BUDGET regressed'))).toHaveLength(2);
  expect(receipts.some(entry=>entry.startsWith('main budget observation'))).toBe(true);
}));

// Meta QA 11-26: the QA writer takes its author only from --agent; main-watch passes WS_AGENT and never a default.
test('memoryQaCall passes WS_AGENT as --agent, and with none set skips the QA row with a receipt line', () => {
  const rows=[{id:45837215166,sha:newer,created:'2026-11-26T14:15:46Z',results:[]}];
  expect(memoryQaCall('codex:gpt-6.2-sol',rows)).toEqual({args:['--agent','codex:gpt-6.2-sol',JSON.stringify(rows)]});
  for(const agent of [undefined,'','  ']){
    const call=memoryQaCall(agent,rows);
    expect(call).toEqual({skipped:expect.stringMatching(/^memory QA skipped for run\(s\) 45837215166: no WS_AGENT/u)});
  }
});

test('a skipped QA write leaves its receipt and clears the queue', () => withRedSpan(({io,receipts})=>{
  const line='BUDGET over-hard key=ledger/made-up-valley/control measured=41767511 baseline=34715334 line=38186867 contentKey=ink@7';
  const calls=[];
  io.budgetRuns=()=>[{status:'completed',event:'push',conclusion:'failure',id:201,head_sha:older,created_at:'2026-11-21T19:01:00Z'}];
  io.budgetAnnotations=()=>line;
  io.memoryQa=(rows)=>{calls.push(rows.length);return memoryQaCall(undefined,rows).skipped;};
  sweep(io);
  expect(calls).toEqual([1]);
  expect(receipts.filter(entry=>entry.startsWith('memory QA skipped for run(s) 201'))).toHaveLength(1);
  expect(readState(io.state)?.memoryQa).toBeUndefined();
  sweep(io);
  expect(calls).toEqual([1]);
}));

// Meta QA 11-25 row 54: engine run 45662209325 named only opus-fr13, whose main-push carried opus-trailer's red commit.
test('a red range names and prompts every lane that landed a commit in it: the pusher and the carried commit\'s author', () => {
  const scratch = mkdtempSync(join(resolve('tmp'), 'main-watch-authors-'));
  try {
    const green = { id: 70, created_at: '2026-11-25T17:00:00Z', head_sha: other, status: 'completed', conclusion: 'success', event: 'push' };
    const runs = [green];
    /** @type {{to:string,text:string}[]} */ const sent = [];
    /** @type {string[]} */ const receipts = [];
    /** @type {Parameters<typeof sweep>[0]} */ const io = {
      repo: 'project-wildshard/engine', state: join(scratch, 'state.json'), runs: () => runs, tip: () => runs.at(-1)?.head_sha ?? other,
      contains: () => true, failed: () => ({ names: [failed], logs: [] }), annotations: () => '',
      commits: () => [newer, older], changes: () => new Map(),
      // opus-fr13's main-push sent its own commit (newer) and carried opus-trailer's (older); a land queue receipt too.
      receipts: () => '12:12 Cancún opus-fr13 main-push pushed main bbbbbbbbbb: 2 commit(s), 1 of them another lane\'s, carried along (M1)\n',
      lanes: () => new Map([[newer, ['opus-fr13']], [older, ['opus-trailer']]]),
      receipt: line => { receipts.push(line); }, panes: () => [], now: () => Date.parse(green.created_at),
      agents: () => new Map([['opus-fr13', 't1'], ['opus-trailer', 't2']]), fixers: () => [],
      send: (to, text) => { sent.push({ to, text }); return true; },
      prompt: (to, text) => { sent.push({ to, text }); return true; }, dispatch: () => undefined,
    };
    sweep(io);
    runs.push({ ...green, id: 71, head_sha: newer, conclusion: 'failure' });
    sweep(io);
    expect(receipts.find(line => line.startsWith('MAIN RED'))).toMatch(/landers opus-fr13, opus-trailer;/u);
    expect(receipts.filter(line => line.startsWith('NOTE RED')).map(line => line.split(':')[0])).toEqual(['NOTE RED opus-fr13', 'NOTE RED opus-trailer']);
    expect(sent.map(row => row.to).sort()).toEqual(['opus-fr13', 'opus-trailer']);
    expect(sent.find(row => row.to === 'opus-trailer')?.text).toContain('aaaaaaaaaa');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('a land queue receipt names its lander by its 9-character SHA', () => {
  const who = landers('17:12 UTC opus-fr13 LAND PUSHED engine 2e2d6786d (QA11-25 52)\n');
  expect(attribute(['2e2d6786d3'.padEnd(40, '0')], who).map(row => row.lander?.lane)).toEqual(['opus-fr13']);
});


test('QA 11-26 row 25 sends to named and labelled hc terminals and routes unreachable landers to coord-r2', () => {
  mkdirSync(resolve('tmp/codex-cookkeys'), { recursive: true });
  const scratch = mkdtempSync(resolve('tmp/codex-cookkeys/main-watch-hc-'));
  const state = join(scratch, 'state.json'), sent = join(scratch, 'sends');
  const named = 'codex-cookkeys', labelled = 'codex-r2fmt', missing = 'opus-pine', blocked = 'codex-blocked';
  const terminals = [
    {address: 't3s', state: 'live', name: named, where: 'other / draft'},
    {address: 't3r', state: 'live', where: `project-wildshard-meta / ${labelled}`},
    {address: 't9', state: 'live', where: blocked},
    {address: 't0', state: 'finished', where: missing},
  ];
  const green = { id: 70, created_at: '2026-11-19T22:00:00Z', head_sha: other, status: 'completed', conclusion: 'success', event: 'push' };
  const red = { ...green, id: 71, head_sha: newer, conclusion: 'failure' };
  const runs = [green], receipts = /** @type {string[]} */ ([]), commits = [newer, older, incoming, 'f'.repeat(40)];
  try {
    writeFileSync(join(scratch, 'hc'), `#!/bin/sh
case "$1" in
  ls) test "$2" = "--json" && printf '%s\n' '${JSON.stringify({terminals})}' ;;
  send) test "$#" = 3 && test "$2" != "t9" && printf '%s %s\n' "$2" "$3" >> "$FAKE_HC_SENDS" ;;
  *) exit 70 ;;
esac
`, { mode: 0o755 });
    const live = liveIo({PATH: scratch, WS_MAIN_WATCH_ROOT: scratch, FAKE_HC_SENDS: sent});
    /** @type {Parameters<typeof sweep>[0]} */
    const io = {
      repo: 'project-wildshard/engine', state, runs: () => runs, tip: () => newer, contains: () => true,
      failed: () => ({ names: [failed], logs: [`FAIL ${testFile} > section host`] }), annotations: () => '',
      commits: () => commits, changes: () => new Map([[newer, [testFile]]]),
      receipts: () => [named, labelled, missing, blocked].map((lane, at) =>
        `17:01 Cancún ${lane} main-push pushed main ${commits[at]?.slice(0, 10)}: 1 commit(s)`).join('\n'),
      receipt: line => { receipts.push(line); }, fixers: () => [], panes: () => [], agents: () => new Map(),
      send: live.send, prompt: live.prompt, hcTerminals: live.hcTerminals, hcSend: live.hcSend, dispatch: () => undefined,
    };
    sweep(io);
    runs.push(red);
    sweep(io); sweep(io);
    expect(readFileSync(sent, 'utf8').trim().split('\n')).toEqual([
      expect.stringContaining('t3s main-watch: MAIN RED.'),
      expect.stringContaining('t3r main-watch: MAIN RED.'),
    ]);
    expect(receipts.filter(line => line.startsWith('NOTE RED coord-r2:'))).toEqual([
      expect.stringContaining(`run 71; relay to ${missing}. main-watch: MAIN RED.`),
      expect.stringContaining(`run 71; relay to ${blocked}. main-watch: MAIN RED.`),
    ]);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
