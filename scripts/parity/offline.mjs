import { compare } from './compare.mjs';
import { get } from './value.mjs';

/** Offline boot has its own contract, not a gameplay baseline: title → play → Explore.
 * Keep the unconditional boot safety checks, without comparing poses, saves or gameplay that this mode never captures.
 * @param {import('./value.mjs').RecordValue} current */
export function compareOffline(current) {
  const checked = compare({}, current);
  for (const step of ['title', 'play', 'explore']) {
    const now = get(current, `offline.${step}`);
    checked.rows.push({ field: `offline.${step}`, baseline: true, now, class: 'D', band: 'completed offline', verdict: now === true ? 'green' : 'red' });
  }
  const errors = get(current, 'boot.errors');
  if (!Array.isArray(errors)) checked.rows.push({ field: 'boot.errors', baseline: [], now: errors, class: 'D', band: 'observed, empty errors', verdict: 'red' });
  checked.verdict = checked.rows.some((row) => row.verdict === 'red') ? 'red' : 'green';
  return checked;
}

/** Each red field names what failed in runner logs as well as the artifact.
 * @param {ReturnType<typeof compare>} checked */
export function failureReasons(checked) {
  return checked.rows.filter((row) => row.verdict === 'red').map((row) =>
    `${row.field}: observed ${JSON.stringify(row.now ?? null).slice(0,400)}; expected ${row.band}${row.class === 'D' ? '' : ` (baseline ${JSON.stringify(row.baseline ?? null).slice(0,400)})`}`);
}
