// HOST-RULER HR5 (meta docs/plans/HOST-RULER-PLAN.md): the one host register, lint/host-register.json, and its reader.
// One row per host module or `module#binding`: a verdict (`engine`/`game` are platform, `pending`/`borderline` charge
// back after `recheck`, `silly` is charged to its users), HOST-BAR's six-test score (unscored allowed), the G or J
// decision behind it, the users known when it was written, and the old-list line(s) it came from. The bar is
// docs/HOST-BAR.md. Nothing reads the register yet: HR6's ruler will.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as v from 'valibot';
import { ENGINE_ROOT, modulePath } from './roots.mjs';

export const REGISTER = 'lint/host-register.json';
/** Kitchen Sink Q4 (b): every stale pending row gets one new recheck date. */
export const RECHECK = '2026-12-11';
export const VERDICTS = /** @type {const} */ (['engine', 'game', 'pending', 'borderline', 'silly']);
export const TESTS = /** @type {const} */ (['twoRealUsers', 'noShardNouns', 'dataDriven', 'serverSafe', 'deletionTest', 'dataOnlyApi']);

const MODULE = /^(?:src\/(?:client|shared|server|cook)\/(?:engine|game|host|app)\/|@wildshard\/format\/src\/format\/)(?:[\w.-]+\/)*[\w.-]+\.ts$/u;
const KEY = v.pipe(v.string(), v.check(key => {
  const [module = '', binding, extra] = key.split('#');
  return extra === undefined && MODULE.test(module) && !module.endsWith('.test.ts') && !module.split('/').includes('..') && (binding === undefined || /^[A-Za-z_$][\w$]*$/u.test(binding));
}, 'a key is a side-first engine module or @wildshard/format/src/format/x.ts, optionally #binding'));
const DATE = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/u));
const From = v.strictObject({ source: v.string(), line: v.pipe(v.number(), v.integer(), v.minValue(1)), selector: v.pipe(v.string(), v.minLength(1)) });
const Row = v.strictObject({
  key: KEY,
  verdict: v.picklist(VERDICTS),
  decision: v.pipe(v.string(), v.regex(/^[GJ]\d+$/u)),
  users: v.array(v.pipe(v.string(), v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))),
  recheck: v.exactOptional(DATE),
  score: v.exactOptional(v.record(v.picklist(TESTS), v.picklist([0, 1]))),
  from: v.pipe(v.array(From), v.minLength(1)),
  note: v.exactOptional(v.string()),
});
const Ids = (/** @type {RegExp} */ shape) => v.strictObject({ source: v.string(), ids: v.array(v.pipe(v.string(), v.regex(shape))) });
const Register = v.strictObject({
  schema: v.literal('wildshard.host-register/1'),
  about: v.string(),
  decisions: v.strictObject({ G: Ids(/^G\d+$/u), J: Ids(/^J\d+$/u) }),
  sources: v.record(v.string(), v.strictObject({ file: v.string(), rows: v.pipe(v.number(), v.integer(), v.minValue(0)) })),
  merged: v.array(v.strictObject({ key: KEY, kept: v.string(), merged: v.pipe(v.array(v.string()), v.minLength(1)) })),
  dropped: v.array(v.strictObject({ key: v.string(), from: From, reason: v.pipe(v.string(), v.minLength(1)) })),
  rows: v.array(Row),
});

/** The file behind a register module, or null when engine and the pinned format package lack it.
 * @param {string} module @param {string} [root] */
export function moduleFile(module, root = ENGINE_ROOT) {
  const path = modulePath(module, root);
  return path !== null && existsSync(path) ? path : null;
}

/** Whether a module's source names a binding at all (declared, exported or re-exported); a cheap guard, not a parse.
 * @param {string} text @param {string} binding */
export const namesBinding = (text, binding) => new RegExp(`(?<![\\w$])${binding.replaceAll('$', String.raw`\$`)}(?![\\w$])`, 'u').test(text);

/** Every reason a parsed register is not valid against the tree at `root`, empty when it is.
 * @param {unknown} json @param {string} [root] @returns {string[]} */
export function hostRegisterProblems(json, root = ENGINE_ROOT) {
  const parsed = v.safeParse(Register, json);
  if (!parsed.success) return parsed.issues.map(issue => `shape: ${v.getDotPath(issue) ?? ''} ${issue.message}`);
  const register = parsed.output, problems = [], seen = new Set(), ids = new Set([...register.decisions.G.ids, ...register.decisions.J.ids]);
  /** @type {Map<string,string>} */
  const texts = new Map();
  for (const row of register.rows) {
    const [module = '', binding] = row.key.split('#');
    if (seen.has(row.key)) problems.push(`${row.key}: duplicate row`);
    seen.add(row.key);
    if (!ids.has(row.decision)) problems.push(`${row.key}: decision ${row.decision} is in neither ${register.decisions.G.source} nor ${register.decisions.J.source}`);
    const recheck = row.verdict === 'pending' || row.verdict === 'borderline';
    if (recheck !== (row.recheck !== undefined)) problems.push(`${row.key}: ${row.verdict} ${recheck ? 'needs' : 'takes no'} recheck date`);
    if (new Set(row.users).size !== row.users.length) problems.push(`${row.key}: duplicate user`);
    if (row.verdict === 'silly' && row.users.length === 0) problems.push(`${row.key}: silly is charged to its users, and names none`);
    for (const from of row.from) if (register.sources[from.source] === undefined) problems.push(`${row.key}: unknown source ${from.source}`);
    const file = moduleFile(module, root);
    if (file === null) { problems.push(`${row.key}: no such module`); continue; }
    if (binding !== undefined) {
      const text = texts.get(file) ?? readFileSync(file, 'utf8');
      texts.set(file, text);
      if (!namesBinding(text, binding)) problems.push(`${row.key}: ${module} never names ${binding}`);
    }
  }
  for (const row of register.dropped) if (register.sources[row.from.source] === undefined) problems.push(`dropped ${row.key}: unknown source ${row.from.source}`);
  // Row count equals the sources minus the listed dedupe: every source row is one `from`, or one dropped row.
  const sourceRows = Object.values(register.sources).reduce((sum, source) => sum + source.rows, 0);
  const fromRows = register.rows.reduce((sum, row) => sum + row.from.length, 0);
  if (sourceRows !== fromRows + register.dropped.length) problems.push(`count: sources list ${sourceRows} rows, the register holds ${fromRows} source lines and ${register.dropped.length} dropped`);
  for (const [name, source] of Object.entries(register.sources)) {
    const used = register.rows.reduce((sum, row) => sum + row.from.filter(from => from.source === name).length, 0) + register.dropped.filter(row => row.from.source === name).length;
    if (used !== source.rows) problems.push(`count: source ${name} lists ${source.rows} rows, the register holds ${used}`);
  }
  const multi = register.rows.filter(row => row.from.length > 1);
  const listed = new Map(register.merged.map(row => [row.key, row.merged.length]));
  if (listed.size !== register.merged.length) problems.push('merged: a key is listed twice');
  for (const row of multi) if (listed.get(row.key) !== row.from.length - 1) problems.push(`${row.key}: ${row.from.length - 1} merged source rows, the dedupe list says ${listed.get(row.key) ?? 0}`);
  for (const key of listed.keys()) if (!multi.some(row => row.key === key)) problems.push(`merged ${key}: no row holds it`);
  return problems;
}

/** Read and validate the register at `root`; refuse with every problem at once.
 * @param {string} [root] */
export function readHostRegister(root = ENGINE_ROOT) {
  const json = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  const problems = hostRegisterProblems(json, root);
  if (problems.length > 0) throw new Error(`host register: ${problems.length} problem(s)\n${problems.join('\n')}`);
  return v.parse(Register, json);
}

/** The register's committed layout: one source, dedupe, drop or row per line, so a diff shows each change.
 * @param {{rows:unknown[], merged:unknown[], dropped:unknown[], sources:Record<string,unknown>, decisions:Record<string,{source:string, ids:string[]}>, [key:string]:unknown}} register */
export function formatRegister(register) {
  const { rows, merged, dropped, sources, decisions, ...head } = register;
  const lines = (/** @type {unknown[]} */ list) => list.length === 0 ? '[]' : `[\n${list.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`;
  const object = (/** @type {Record<string,unknown>} */ record) => `{\n${Object.entries(record).map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n  }`;
  const top = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${[...top, `  "decisions": ${object(decisions)}`, `  "sources": ${object(sources)}`, `  "merged": ${lines(merged)}`, `  "dropped": ${lines(dropped)}`, `  "rows": ${lines(rows)}`].join(',\n')}\n}\n`;
}
