export const SCHEMA_TYPE_RULE = 'wildshard/explicit-schema-types';
/** Validate identity paths before policy tools read any source. */
export function schemaTypeIdentity(identity) {
  const split=identity.lastIndexOf('#'),file=identity.slice(0,split),name=identity.slice(split+1);
  if (!file.startsWith('src/format/') || !file.endsWith('.ts') || file.split('/').some(part=>!part || part==='.' || part==='..')
    || !/^[$A-Z_a-z][$\w]*$/u.test(name)) throw new Error(`Invalid schema export identity: ${identity}`);
  return {file,name};
}

// Policy increases require one exact coordinator approval per increased row.
/** @param {Record<string, object>} before
 * @param {Record<string, object>} after @param {string} message
 * @param {'lint'|'tiles'} [scope] Tile policy is checked by the mandatory commit-message hook. */
export function ratchetApprovalFailures(before, after, message, scope = 'lint') {
  // The repository requires a blank line before the final attribution.
  const content = message.trimEnd().replace(/\n\nAssisted-by:[^\n]+$/u, '');
  const unfolded = content.replaceAll(/\n[ \t]+/gu, ' ');
  const footer = unfolded.split(/\n\s*\n/u).at(-1) ?? '';
  const approvals = unfolded.split('\n').filter(line => line.startsWith('Ratchet-Approved:')
    && line.startsWith('Ratchet-Approved: wildshard-new wildshard/tile-bake ') === (scope === 'tiles'));
  const increases = new Map();
  for (const [rule, rows] of Object.entries(after)) {
    if (!rule.startsWith('wildshard/')) continue;
    const priorRows = before[rule] ?? {};
    // A removed file key pays for one new key under the same rule. Tile
    // coordinates retain their separate exact-identity approval contract.
    const removed = scope === 'tiles' ? [] : Object.entries(priorRows)
      .filter(([file, count]) => !Object.hasOwn(rows, file) && typeof count === 'number' && count > 0)
      .map(([, count]) => Number(count)).sort((a, b) => a - b);
    for (const [file, count] of Object.entries(rows)) {
      /** @type {unknown} */
      const previous=Object.hasOwn(before,rule) ? Reflect.get(before[rule],file) : 0;
      const delta = count - (typeof previous==='number' ? previous : 0);
      if (delta > 0) {
        const move = !Object.hasOwn(priorRows, file) ? removed.findIndex(limit => count <= limit) : -1;
        if (move >= 0) removed.splice(move, 1);
        else increases.set(`${rule} ${file}`,delta);
      }
    }
  }
  // A name swap at an unchanged file count is still newly admitted debt.
  /** @param {object} policy */
  const identities=policy=>{
    /** @type {unknown} */
    const allow=Reflect.get(policy,'allow');
    if (allow===null || typeof allow!=='object') return {};
    /** @type {unknown} */
    const rows=Reflect.get(allow,SCHEMA_TYPE_RULE);
    return rows!==null && typeof rows==='object' ? rows : {};
  };
  const beforeNames=identities(before),afterNames=identities(after);
  const added=new Map();
  for (const identity of Object.keys(afterNames)) if (!Object.hasOwn(beforeNames,identity)) {
    const {file}=schemaTypeIdentity(identity);added.set(file,(added.get(file) ?? 0)+1);
  }
  for (const [file,count] of added) {
    const key=`${SCHEMA_TYPE_RULE} ${file}`;
    increases.set(key,Math.max(increases.get(key) ?? 0,count));
  }
  const expected=new Set([...increases].map(([key,count])=>`Ratchet-Approved: wildshard-new ${key} +${count}`));
  const failures = [];
  const seen = new Set();
  for (const line of approvals) {
    if (!expected.has(line)) continue;
    if (!footer.split('\n').includes(line) || seen.has(line)) failures.push(`Invalid or unmatched ratchet approval: ${line}`);
    seen.add(line);
  }
  for (const line of expected) if (!seen.has(line)) failures.push(`Missing ratchet approval: ${line}`);
  return failures;
}
