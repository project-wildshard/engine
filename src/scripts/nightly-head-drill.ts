// Manual single-head negative control. Every pass uses the actual cold-pack phone runner.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {headGroups, phases, plan, read, verdict, type HeadsReport} from './nightly-model.ts';

const [browser, groupText, directory, slug] = process.argv.slice(2);
assert.ok(browser === 'chromium' || browser === 'webkit');
assert.ok(directory !== undefined && slug !== undefined);
const expected = plan(), group = Number(groupText);
const head = headGroups(expected.heads, browser)[group]?.find(row => row.slug === slug);
assert.ok(head !== undefined, 'Drill requires an actual committed head in its ordinary partition');
const out = resolve(directory); mkdirSync(out, {recursive: true});
const records: {name: string; exit: number | null; sha256: string; file: string}[] = [];
const checkpoint = (comparison?: unknown) => writeFileSync(join(out, 'drill.json'), `${JSON.stringify({
  version: 1, sha: expected.sha, pins: expected.pins, testList: expected.testList,
  head, browser, fault: 'remove actual hover touch control', diagnosticOnly: true,
  qualification: 'HOLD: only one head/browser observed; full nightly still required', records, comparison,
}, null, 2)}\n`);
checkpoint();
const run = (name: string, fault: 'none' | 'hover-control'): HeadsReport => {
  const folder = join(out, name);
  const child = spawnSync(process.execPath, ['src/scripts/nightly-heads.ts', browser, String(group), folder, slug, fault],
    {stdio: 'inherit', timeout: 1_200_000});
  // A driver/process timeout or crash is never a qualifying planted failure.
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  const file = join(folder, `heads-${browser}-${group}.json`);
  const report = read(file) as HeadsReport & {diagnosticFault: string};
  records.push({name, exit: child.status, file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex')}); checkpoint();
  assert.equal(child.status, fault === 'none' ? 0 : 1);
  assert.equal(report.version, expected.version); assert.equal(report.sha, expected.sha);
  assert.equal(report.pins, expected.pins); assert.equal(report.testList, expected.testList);
  assert.equal(report.browser, browser); assert.equal(report.group, group); assert.equal(report.diagnosticFault, fault);
  assert.equal(report.results.length, 1);
  const [row] = report.results; assert.ok(row !== undefined);
  assert.equal(row.slug, head.slug); assert.equal(row.hash, head.hash);
  assert.equal(row.phases.length, phases.length);
  assert.deepEqual(row.phases.map(phase => phase.name).sort(), [...phases].sort());
  const failed = row.phases.filter(phase => !phase.ok);
  assert.deepEqual(failed.map(phase => phase.name), fault === 'none' ? [] : ['hover']);
  if (fault !== 'none') {
    // The ordinary real tap refuses the absent control; later native draw and
    // Explorer must pass too, ruling out a stalled page or failed process.
    assert.match(failed[0]?.error ?? '', /hover mount failed: TimeoutError: locator\.tap:/u);
    const draw = row.phases.find(phase => phase.name === 'draw')?.detail;
    assert.ok(typeof draw === 'object' && draw !== null && 'frames' in draw && draw.frames === 30);
  }
  return report;
};
const baseline = run('baseline', 'none'), planted = run('planted', 'hover-control'), healed = run('healed', 'none');
const before = verdict(expected, [baseline]);
const red = verdict(expected, [planted], before);
const after = verdict(expected, [healed], red);
const key = `${browser}/${head.slug}@${head.hash}/hover`;
assert.equal(before.tag, 'HOLD'); assert.equal(red.tag, 'HOLD'); assert.equal(after.tag, 'HOLD');
assert.deepEqual(red.newFailures, [key]); assert.deepEqual(red.resolved, []);
assert.deepEqual(after.newFailures, []); assert.deepEqual(after.resolved, [key]);
assert.deepEqual(after.failures, before.failures);
checkpoint({baselineFailures: before.failures.length, onlyNewFailure: key, newFailures: red.newFailures,
  healedResolved: after.resolved, healedFailuresEqualBaseline: true});
console.log(`Single-head real-input fault caught only ${key}; healed; partial evidence holds release qualification`);
