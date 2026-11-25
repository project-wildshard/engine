// Meta QA 11-25 row 58: every commit made under a lane names it, so main-push and land push only the pushing lane's own
// commits (scripts/lane-commits.mjs). A commit made under WS_LANE_NAME with no `Lane:` line gets one, in main-push's
// shape (M11): its own paragraph just above the final `Assisted-by:` line, or at the end when there is none. Git's
// merge, fixup, squash and amend messages, and a commit made under no lane name, are left alone.
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const LANE = /^[a-z][a-z0-9_-]*$/u;
const GENERATED = /^(?:Merge |Revert "|fixup! |squash! |amend! )/u;

/** The message with a `Lane:` line for `lane`, or the message unchanged. @param {string} raw @param {string|undefined} lane */
export function withLane(raw, lane) {
  if (lane === undefined || !LANE.test(lane)) return raw;
  const lines = raw.replace(/\r\n/gu, '\n').split('\n');
  const content = lines.filter(line => !line.startsWith('#'));
  if (GENERATED.test(content.find(line => line.trim() !== '') ?? '') || content.some(line => /^Lane: \S/u.test(line))) return raw;
  // The message ends before git's comment block (and any `commit -v` scissors below it).
  let end = lines.length;
  while (end > 0 && (lines[end - 1]?.startsWith('#') || lines[end - 1]?.trim() === '')) end--;
  const assisted = lines.slice(0, end).findLastIndex(line => /^Assisted-by: /u.test(line));
  if (assisted >= 0) {
    lines.splice(assisted, 0, `Lane: ${lane}`, '');
    // Keep one blank line between the body and the new paragraph.
    if (assisted > 0 && lines[assisted - 1]?.trim() !== '') lines.splice(assisted, 0, '');
  } else lines.splice(end, 0, '', `Lane: ${lane}`);
  return lines.join('\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (file !== undefined) {
    const raw = readFileSync(file, 'utf8'), next = withLane(raw, process.env.WS_LANE_NAME);
    if (next !== raw) writeFileSync(file, next);
  }
}
