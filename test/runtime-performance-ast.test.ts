// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual lint AST in an isolated policy process.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove only the bounded policy fixture.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the checked helper and fixture inputs.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Import the actual checker from the fixture plugin.
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { runtimePerformanceSites } from '../lint/runtime-performance.mjs';

test('hot propagation keeps aliases, cycles and every same-named helper', () => {
  const source = `function first() { second(); }
function second() { first(); }
function helper() { return []; }
function owner() { function helper() { return {}; } return helper; }
const scheduled = first;
system(scheduled);
export function update() { helper(); }
function cold() { return new Set(); }
`;
  const sites = runtimePerformanceSites(source);
  expect(sites.filter(site => site.kind === 'unbounded-loop').map(site => source.slice(site.start, site.end)))
    .toEqual(['function first() { second(); }', 'function second() { first(); }']);
  expect(sites.filter(site => site.kind === 'frame-allocation').map(site => source.slice(site.start, site.end))).toEqual(['[]', '{}']);
  expect(sites).toHaveLength(4);
});

test('supplied lint AST retains its controls after shard runtime retirement', () => {
  const inventory = spawnSync('git', ['ls-files', '-z', '--', 'src/shards'], { encoding: 'utf8' });
  expect(inventory.status, inventory.stderr).toBe(0);
  const files = inventory.stdout.split('\0').filter(file => /^src\/shards\/[^/]+\/runtime\/.*\.[jt]s$/u.test(file));
  // LD9 retires every copied shard runtime; the owned edge fixture below
  // still exercises all original AST, native-site and frozen-digest checks.
  expect(files).toEqual([]);
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/runtime-ast-'));
  try {
    const plugin = resolve(root, 'plugin.mjs'), config = resolve(root, 'policy.json');
    const fixture = resolve(root, 'edge.ts');
    writeFileSync(fixture, `type Data = { label: string };
const count = 3, alias = run;
function run() { return ['x']; }
system(alias);
export function update(data: Data) {
  const text = data.label + ' suffix';
  for (let i = 0; i < count; i++) consume(text);
  while (data.label) { fetch(text); }
  document.body.innerHTML = text;
}
export function tick() { update({ label: 'x' }); tick(); }
`);
    writeFileSync(plugin, `import { createHash } from 'node:crypto';
import { runtimePerformanceSites, runtimePerformanceViolations, frozenRuntimePerformanceViolations } from ${JSON.stringify(pathToFileURL(resolve('lint/runtime-performance.mjs')).href)};
export default { meta: { name: 'runtime-ast-proof' }, rules: { same: { create(context) {
  return { Program(program) {
    const text = context.sourceCode.text, file = context.filename;
    const sites = runtimePerformanceSites(text, file);
    const baseline = Object.fromEntries(sites.map(site => [file + ':' + site.kind + ':' + site.site, { count: 1, row: 'fixture' }]));
    const digest = createHash('sha256').update(text).digest('hex');
    const pairs = [
      [sites, runtimePerformanceSites(text, file, program)],
      [runtimePerformanceViolations(text, file, baseline), runtimePerformanceViolations(text, file, baseline, program)],
      [frozenRuntimePerformanceViolations(text, file, file, digest, baseline), frozenRuntimePerformanceViolations(text, file, file, digest, baseline, program)],
      [frozenRuntimePerformanceViolations(text, file, file, '0'.repeat(64), baseline), frozenRuntimePerformanceViolations(text, file, file, '0'.repeat(64), baseline, program)],
    ];
    for (const [before, after] of pairs) if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Runtime AST parity failed: ' + file);
    context.report({ node: program, message: 'Exact runtime AST parity: ' + sites.length });
  } };
} } } };
`);
    writeFileSync(config, JSON.stringify({ jsPlugins: [plugin], categories: { correctness: 'off' },
      rules: { 'runtime-ast-proof/same': 'error' } }));
    const result = spawnSync(resolve('node_modules/.bin/oxlint'), ['--config', config, '--no-ignore', '--format', 'json', ...files, fixture],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    expect(result.status, result.stderr).toBe(1);
    const output = v.parse(v.object({ diagnostics: v.array(v.object({ message: v.string() })) }), JSON.parse(result.stdout));
    expect(output.diagnostics).toHaveLength(files.length + 1);
    expect(output.diagnostics.every(row => /^Exact runtime AST parity: \d+$/u.test(row.message))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
