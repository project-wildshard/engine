// oxlint-disable-next-line import/no-nodejs-modules -- Failed native replay artifacts survive the subprocess for triage.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Diagnostics belong to an owned temporary directory, never gameplay saves.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Join the owned diagnostic artifact paths.
import { join } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The CI artifact directory is an explicit failure-only output port.
import process from 'node:process';
import { capturedNumberPathProbe } from '../../scripts/number-path-probe.mjs';
import { decodeSimSnapshot, type SimSnapshot } from '../../src/shared/engine/sim/snapshot';
import { canonicalSimDigest, physicsState } from './simState';

interface FieldDifference { path: string; expected: unknown; actual: unknown; record?: string }
function preview(value: unknown, limit = 512): string {
  const serialized: unknown = JSON.stringify(value);
  return (typeof serialized === 'string' ? serialized : String(value)).slice(0, limit);
}
function adapterOwner(path: string, state: unknown): string | undefined {
  if (!object(state)) return undefined;
  const match = /^state\["adapters"\]\[(\d+)\]/u.exec(path), adapters = state['adapters'];
  if (match === null || !Array.isArray(adapters)) return undefined;
  const row: unknown = adapters[Number(match[1])];
  return object(row) && typeof row['id'] === 'string' ? row['id'] : undefined;
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function embedded(value: string): unknown {
  try { const parsed: unknown = JSON.parse(value); return parsed !== null && typeof parsed === 'object' ? parsed : undefined; }
  catch { return undefined; }
}
/** Preserve every IEEE-754 bit, including signed zero, as the canonical physics digest does. */
function floatBits(value: number): string {
  const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value);
  return bytes.getBigUint64(0).toString(16).padStart(16, '0');
}
function canonical(snapshot: SimSnapshot | string, digest?: string) {
  const decoded = typeof snapshot === 'string' ? decodeSimSnapshot(snapshot) : snapshot;
  const { physics, ...rest } = decoded, native = physicsState(physics);
  // The digest uses JSON.stringify(rest), which omits undefined and canonicalizes JSON numbers.
  const stateJson = JSON.stringify(rest), state: unknown = JSON.parse(stateJson);
  return { digest: digest ?? canonicalSimDigest(decoded), state, physics: { values: native.values, float64Bits: native.values.map(floatBits), records: native.marks } };
}
function fields(expected: unknown, actual: unknown, path: string, out: FieldDifference[]): void {
  if (Object.is(expected, actual)) return;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const a: readonly unknown[] = expected, b: readonly unknown[] = actual;
    if (a.length !== b.length) out.push({ path: `${path}.length`, expected: a.length, actual: b.length });
    for (let i = 0; i < Math.max(a.length, b.length); i++) fields(a[i], b[i], `${path}[${String(i)}]`, out);
  } else if (object(expected) && object(actual)) {
    const a = Object.keys(expected), b = Object.keys(actual);
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: `${path}.$keys`, expected: a, actual: b });
    for (const key of new Set([...a, ...b])) fields(expected[key], actual[key], `${path}[${JSON.stringify(key)}]`, out);
  } else if (typeof expected === 'string' && typeof actual === 'string') {
    const a = embedded(expected), b = embedded(actual);
    if (a !== undefined && b !== undefined) {
      const before = out.length; fields(a, b, `${path}.$json`, out);
      // String formatting itself participates in the exact snapshot hash, even with equal parsed values.
      if (out.length === before) out.push({ path, expected, actual });
    } else out.push({ path, expected, actual });
  } else out.push({ path, expected, actual });
}

/** Failure-only replay diagnostics. The caller's exact mismatch assertion still throws, even if artifact writing fails. */
export function simMismatchError(message: string, expected: SimSnapshot | string, actual: SimSnapshot | string, compared?: { expected: string; actual: string }): Error {
  try {
    const a = canonical(expected, compared?.expected), b = canonical(actual, compared?.actual), differences: FieldDifference[] = [];
    fields(a.state, b.state, 'state', differences);
    for (let i = 0; i < Math.max(a.physics.float64Bits.length, b.physics.float64Bits.length); i++) {
      if (a.physics.float64Bits[i] === b.physics.float64Bits[i]) continue;
      let record = 'physics';
      for (const [start, name] of a.physics.records) { if (start > i) break; record = name; }
      differences.push({ path: `physics.float64Bits[${String(i)}]`, record,
        expected: { value: a.physics.values[i], bits: a.physics.float64Bits[i] }, actual: { value: b.physics.values[i], bits: b.physics.float64Bits[i] } });
    }
    const directory = mkdtempSync(join(tmpdir(), 'wildshard-replay-mismatch-'));
    writeFileSync(join(directory, 'expected.canonical.json'), `${JSON.stringify(a, null, 2)}\n`);
    writeFileSync(join(directory, 'actual.canonical.json'), `${JSON.stringify(b, null, 2)}\n`);
    writeFileSync(join(directory, 'diff.json'), `${JSON.stringify({ message, expectedDigest: a.digest, actualDigest: b.digest, differences }, null, 2)}\n`);
    const artifactRoot = process.env['WS_REPLAY_DIAGNOSTICS_DIR'];
    const numberPaths = capturedNumberPathProbe();
    if (artifactRoot !== undefined && artifactRoot !== '' && numberPaths !== undefined) {
      // Upload only this bounded report, never the complete snapshots above.
      const selected = [...differences.filter(row => row.record === undefined).slice(0, 16),
        ...differences.filter(row => row.record !== undefined).slice(0, 16)];
      const report = { message: message.slice(0, 512), expectedDigest: a.digest, actualDigest: b.digest,
        differenceCount: differences.length, truncated: selected.length < differences.length,
        differences: selected.map(row => ({ path: row.path.slice(0, 512),
          adapter: adapterOwner(row.path, a.state) ?? null,
          record: row.record?.slice(0, 128),
          expected: preview(row.expected), actual: preview(row.actual) })),
        numberPaths };
      let text = `${JSON.stringify(report, null, 2)}\n`;
      while (new TextEncoder().encode(text).byteLength > 128 * 1024 && report.differences.length > 0) {
        report.differences.pop(); report.truncated = true;
        text = `${JSON.stringify(report, null, 2)}\n`;
      }
      if (new TextEncoder().encode(text).byteLength > 128 * 1024) throw new Error('Bounded replay report exceeds 128 KiB');
      mkdirSync(artifactRoot, { recursive: true });
      writeFileSync(join(artifactRoot, `replay-${a.digest.slice(0, 16)}-${b.digest.slice(0, 16)}.json`), text);
    }
    const excerpt = differences.slice(0, 8).map(row => `${(adapterOwner(row.path, a.state) ?? row.record ?? '').slice(0, 64)} ${row.path.slice(0, 64)}: ${preview(row.expected, 32)} != ${preview(row.actual, 32)}`).join('; ');
    return new Error(`${message}; ${differences.length} differing fields: ${excerpt}; canonical snapshots and field diff: ${directory}`);
  } catch (cause) { return new Error(`${message}; diagnostic artifact failed`, { cause }); }
}
