// Commit message parsing shared by the hook and the packaged lane tooling.
const SCISSORS = /^# -+ >8 -+$/;
const SHARD_PIN_TRAILER = 'Assisted-by: shard-pin:workflow';
const SHARD_PIN_SUBJECT = /^test\(pins\): (?:pin [a-z0-9-]+ rev [1-9][0-9]*|[a-z0-9-]+ darwin Ring 1 digest)$/u;

/** Drop comments and everything below a `commit -v` scissors line. @param {string} raw */
export function clean(raw) {
  const lines = [];
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (SCISSORS.test(line)) break;
    if (!line.startsWith('#')) lines.push(line.trimEnd());
  }
  while (lines.length && !lines.at(-1)) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines;
}

/** The lane implied by the exact workflow message, including pins already produced without a Lane line.
 * @param {string} raw @returns {'shard-pin' | null} */
export function shardPinWorkflowLane(raw) {
  if (!raw.includes(SHARD_PIN_TRAILER)) return null;
  const lines = clean(raw);
  return SHARD_PIN_SUBJECT.test(lines[0] ?? '') &&
    lines.at(-1) === SHARD_PIN_TRAILER && lines.at(-2) === '' &&
    lines.filter(line => /^assisted-by:/iu.test(line)).length === 1 ? 'shard-pin' : null;
}
