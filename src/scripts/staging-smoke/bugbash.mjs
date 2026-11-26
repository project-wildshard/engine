// Meta STAGING-SMOKE SM6: a run's findings become STAGING-BUGBASH rows (meta docs/plans/STAGING-BUGBASH-PLAN.md) in a group of
// their own, "found by staging smoke vX.Y.Z". A finding whose key (scenario plus check) matches an open row gets a "seen again"
// line on that row instead. The caller commits the plan file (meta-push.mjs).

/** @typedef {import('./checks.mjs').Finding} Finding */

/** The token that keys a row to its scenario and check. @param {Pick<Finding, 'scenario' | 'key'>} f */
export const smokeKey = (f) => `smoke key \`${f.scenario}/${f.key}\``;

/**
 * SM8's bar, answered for a finding (the "scenario?" field): a new bug becomes a scenario only if it is P0 or P1, no kept
 * scenario's check or vision pass caught it, T1 or the J386 gate cannot hold it, and it adds at most 45 s. A smoke finding
 * was caught by a kept scenario, so the answer is always no; the field says which check holds it.
 * @param {Finding} f
 */
export function scenarioAnswer(f) {
  return `no: ${f.scenario}'s ${f.source === 'vision' ? 'vision pass' : `\`${f.key}\` check`} already holds it (SM8 bar (b))`;
}

/** @param {string} text @returns {string} */
const cell = (text) => text.replaceAll('|', '/').replaceAll('\n', ' ');

/**
 * The plan file with this run's findings written in.
 * @param {string} plan the STAGING-BUGBASH plan's text
 * @param {readonly Finding[]} findings
 * @param {{ release: string, build?: string }} run
 * @returns {{ text: string, added: string[], seenAgain: string[], rowOf: Record<string, string> }}
 */
export function bugbashRows(plan, findings, { release, build }) {
  const lines = plan.split('\n');
  /** @type {string[]} */
  const added = [], seenAgain = [];
  /** @type {Record<string, string>} the SB row each finding's `scenario/key` went to */
  const rowOf = {};
  /** @type {string[]} */
  const rows = [];
  let next = Math.max(0, ...[...plan.matchAll(/\bSB(\d+)/gu)].map((m) => Number(m[1]))) + 1;
  for (const f of findings) {
    const token = smokeKey(f);
    const open = lines.findIndex((l) => /^\| SB\d+\w* \|/u.test(l) && l.includes(token) && !/^\| SB\d+\w* \| \[x\]/u.test(l));
    if (open !== -1) {
      const line = lines[open] ?? '';
      const at = line.lastIndexOf(' | ', line.length - 3);
      lines[open] = `${line.slice(0, at)} Seen again on ${release}${build === undefined ? '' : ` (\`${build.slice(0, 8)}\`)`}.${line.slice(at)}`;
      const id = line.split(' | ')[0]?.replace('| ', '') ?? '';
      seenAgain.push(id);
      rowOf[`${f.scenario}/${f.key}`] = id;
      continue;
    }
    const id = `SB${String(next++)}`;
    const where = [f.frame === undefined ? '' : `frame \`${f.frame}\``, f.video === undefined ? '' : `clip \`${f.video}\``].filter(Boolean).join(', ');
    rows.push(`| ${id} | **${cell(f.text)} (${f.severity}, found by staging smoke ${release}, ${f.scenario}).** ${token}${where === '' ? '' : `; ${where}`}. Scenario? ${scenarioAnswer(f)}. | The staging smoke passes \`${f.key}\` in ${f.scenario}, or a T1 test holds the fix. |`);
    added.push(id);
    rowOf[`${f.scenario}/${f.key}`] = id;
  }
  if (rows.length > 0) {
    const letters = [...plan.matchAll(/^### Group ([A-Z]):/gmu)].map((m) => m[1] ?? 'A');
    const letter = String.fromCodePoint(Math.max(64, ...letters.map((l) => l.codePointAt(0) ?? 64)) + 1);
    const group = ['', `### Group ${letter}: found by staging smoke ${release}${build === undefined ? '' : ` (\`${build.slice(0, 8)}\`)`}`, '', '| Row | Work | Done when |', '|---|---|---|', ...rows];
    // the group goes after the last row group, before the next `## ` section
    const lastGroup = lines.reduce((at, l, i) => (l.startsWith('### Group ') ? i : at), -1);
    const end = lastGroup === -1 ? lines.length : lines.findIndex((l, i) => i > lastGroup && l.startsWith('## '));
    const at = end === -1 ? lines.length : end;
    let insert = at;
    while (insert > 0 && (lines[insert - 1] ?? '').trim() === '') insert--;
    lines.splice(insert, 0, ...group);
  }
  return { text: lines.join('\n'), added, seenAgain, rowOf };
}
