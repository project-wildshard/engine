// Meta QA 11-25 row 95 (from row 68 (m), J505): setup-node's `node-version-file: package.json` resolved engines
// `>=24.18.0 <27` to whatever Node the runner cached, so ci 45754077050 ran 23 jobs on 24.22.3 and 3 on 26.13.1, and a
// Node 26 break showed on one shard by chance. Every setup-node step in a workflow or local action names one major: the
// root `.node-version` (26), or a literal version on that same major. A range, `lts/*`, `latest` or no version at all
// leaves the major to the runner image, and this test refuses it.
// oxlint-disable-next-line import/no-nodejs-modules -- The guard reads the workflow files themselves.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const PIN_FILE = '.node-version';
/** A version that names its major: `26`, `26.13`, `v26.13.1`. No `x`, range, alias or expression. */
const FIXED = /^v?(\d+)(?:\.\d+){0,2}$/u;

/** Each setup-node step's text, by the line its `- ` item starts on. */
function setupNodeSteps(text: string): { line: number; body: string }[] {
  const lines = text.split('\n');
  const steps: { line: number; body: string }[] = [];
  lines.forEach((row, at) => {
    if (!/uses:\s*actions\/setup-node@/u.test(row)) return;
    let start = at;
    while (start > 0 && !/^\s*- /u.test(lines[start] ?? '')) start -= 1;
    const indent = /^(\s*)- /u.exec(lines[start] ?? '')?.[1]?.length ?? 0;
    let end = start + 1;
    while (end < lines.length) {
      const next = lines[end] ?? '';
      if (next.trim() !== '' && (next.length - next.trimStart().length) <= indent) break;
      end += 1;
    }
    steps.push({ line: start + 1, body: lines.slice(start, end).join('\n') });
  });
  return steps;
}

/** The step's `with:` value for `key`, block or flow style, unquoted. */
function withValue(body: string, key: string): string | undefined {
  const value = new RegExp(`(?:^|[\\s{,])${key}:\\s*([^,}\\n#]+)`, 'u').exec(body)?.[1]?.trim();
  return value?.replace(/^(['"])(.*)\1$/u, '$2');
}

/**
 * Why a setup-node step leaves the Node major open, or undefined when it names `major`.
 * @param readPin the text of a `node-version-file` the step names, or undefined when the file is missing
 */
function openMajor(body: string, major: string, readPin: (file: string) => string | undefined): string | undefined {
  const version = withValue(body, 'node-version');
  const file = withValue(body, 'node-version-file');
  if (version === undefined && file === undefined) return 'names no node-version, so the runner image picks the Node';
  let named = version;
  if (version === undefined && file !== undefined) {
    if (file !== PIN_FILE) return `reads node-version-file ${file}; read ${PIN_FILE}, which names one major`;
    named = readPin(file)?.trim();
    if (named === undefined) return `reads ${file}, which is missing`;
  }
  const got = FIXED.exec(named ?? '')?.[1];
  if (got === undefined) return `node-version "${named}" is not one fixed version, so the runner's cache picks the major`;
  if (got !== major) return `node-version "${named}" is Node ${got}, not ${PIN_FILE}'s ${major}`;
  return undefined;
}

function workflowFiles(): string[] {
  const files = readdirSync('.github/workflows').filter(name => /\.ya?ml$/u.test(name)).map(name => `.github/workflows/${name}`);
  for (const action of readdirSync('.github/actions')) {
    for (const name of ['action.yml', 'action.yaml']) {
      if (existsSync(`.github/actions/${action}/${name}`)) files.push(`.github/actions/${action}/${name}`);
    }
  }
  return files;
}

test(`${PIN_FILE} names Node 26, one major engines.node admits`, () => {
  const pin = readFileSync(PIN_FILE, 'utf8').trim();
  expect(pin).toBe('26');
  const range = (JSON.parse(readFileSync('package.json', 'utf8')) as { engines: { node: string } }).engines.node;
  const [, low, high] = /^>=(\d+)\.\d+\.\d+ <(\d+)$/u.exec(range) ?? [];
  expect(Number(low) <= Number(pin) && Number(pin) < Number(high), `engines.node "${range}" admits Node ${pin}`).toBe(true);
});

test('every setup-node step in a workflow or local action names the pinned Node major', () => {
  const major = readFileSync(PIN_FILE, 'utf8').trim();
  const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
  const findings: string[] = [];
  let steps = 0;
  for (const file of workflowFiles()) {
    for (const step of setupNodeSteps(readFileSync(file, 'utf8'))) {
      steps += 1;
      const why = openMajor(step.body, major, read);
      if (why !== undefined) findings.push(`${file}:${step.line} ${why}`);
    }
  }
  expect(steps).toBeGreaterThan(20);
  expect(findings).toEqual([]);
});

test('the guard refuses each way a step leaves the major open', () => {
  const pins: Record<string, string> = { '.node-version': '26\n', 'package.json': '{}' };
  const read = (file: string) => pins[file];
  const step = (withLines: string) => setupNodeSteps(`steps:\n  - uses: actions/setup-node@abc\n${withLines}\n  - run: true\n`)[0]?.body ?? '';
  expect(openMajor(step('    with:\n      node-version-file: package.json'), '26', read)).toMatch(/package\.json/u);
  expect(openMajor(step('    with:\n      node-version: 24.x'), '26', read)).toMatch(/not one fixed/u);
  expect(openMajor(step("    with:\n      node-version: 'lts/*'"), '26', read)).toMatch(/not one fixed/u);
  expect(openMajor(step('    with:\n      node-version: ">=24 <27"'), '26', read)).toMatch(/not one fixed/u);
  expect(openMajor(step('    with:\n      cache: pnpm'), '26', read)).toMatch(/names no node-version/u);
  expect(openMajor(step('    with: {node-version: 24, cache: pnpm}'), '26', read)).toMatch(/Node 24, not/u);
  expect(openMajor(step('    with:\n      node-version-file: .node-version'), '26', () => undefined)).toMatch(/missing/u);
  expect(openMajor(step('    with:\n      node-version-file: .node-version'), '26', read)).toBeUndefined();
  expect(openMajor(step('    with: {node-version-file: .node-version, cache: pnpm}'), '26', read)).toBeUndefined();
  expect(openMajor(step('    with:\n      node-version: "26"'), '26', read)).toBeUndefined();
  // A step that starts with `- if:` and names setup-node on its second line is still read whole.
  const guarded = setupNodeSteps('    steps:\n      - if: x\n        uses: actions/setup-node@abc\n        with:\n          node-version-file: package.json\n      - run: true\n');
  expect(guarded).toHaveLength(1);
  expect(openMajor(guarded[0]?.body ?? '', '26', read)).toMatch(/package\.json/u);
});
