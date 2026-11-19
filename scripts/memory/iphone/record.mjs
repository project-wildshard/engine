import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { commands, parseJetsam, parseSyslog, parseSysmon, PROCESSES } from '../iphone-footprint.mjs';

/** Native OS capture leaves the Safari WebContent process out of the screenshot path.
 * @param {string} udid @param {string} file @returns {Promise<void>} */
export async function takeScreenshot(udid, file) {
  const capture = launch(['xcrun', 'devicectl', 'device', 'capture', 'screenshot', '--device', udid, '--destination', file], `${file}.log`);
  const result = await Promise.race([capture.done, delay(90_000, null, { ref: false })]);
  if (result === null) {
    await capture.stop();
    throw new Error('devicectl screenshot timed out');
  }
  if (result.code !== 0 || !existsSync(file)) throw new Error(result.error ?? `devicectl screenshot failed (${result.code}). See ${file}.log`);
}

/** @param {string[]} command @param {string} log */
function launch(command, log) {
  const fd = openSync(log, 'w');
  /** @type {import('node:child_process').ChildProcess} */
  let child;
  try {
    child = spawn(command[0], command.slice(1), { stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  const done = /** @type {Promise<{code:number|null, error:string|null}>} */ (new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, error: error.message }));
    child.once('close', (code) => resolve({ code, error: null }));
  }));
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return done;
    child.kill('SIGINT');
    const finished = await Promise.race([done, delay(20_000, null, { ref: false })]);
    if (finished !== null) return finished;
    child.kill('SIGKILL');
    return done;
  }
  return { done, stop };
}

/** @param {string} file */
function readLines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    return [];
  }
}

/** @param {string} line */
export function timedSample(line) {
  const row = parseSysmon(line);
  if (row === null) return null;
  const value = JSON.parse(line).timestamp;
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? { ...row, time } : null;
}

/** @typedef {NonNullable<ReturnType<typeof timedSample>>} TimedSample */
/** @typedef {Pick<TimedSample, 'pid' | 'time' | 'physFootprint'>} FootprintSample */
/** @param {FootprintSample[]} samples @param {number} openedAt @param {number | null} controlAt */
export function footprintWindow(samples, openedAt, controlAt) {
  const current = samples.filter((row) => row.time >= openedAt);
  const active = new Set(current.map((row) => row.pid));
  const old = new Set(samples.filter((row) => row.time < openedAt).map((row) => row.pid));
  const fresh = [...active].filter((pid) => !old.has(pid));
  // If a tab process already existed, only accept it when there is a single
  // candidate. Never merge two Safari tabs into one memory reading.
  // The inspector driver keeps Safari's tab, so the zone's process can predate the trial beside an idle one: take the one
  // whose peak is at least 4x every other's (a 6 MB spare beside a 1.4 GB zone), else none.
  const peaks = [...active].map((pid) => /** @type {[number, number]} */ ([pid, Math.max(...current.filter((row) => row.pid === pid).map((row) => row.physFootprint))]))
    .sort((a, b) => b[1] - a[1]);
  const dominant = peaks.length > 1 && peaks[0][1] >= 4 * peaks[1][1] ? peaks[0][0] : null;
  // a fresh process counts only if it is not a spare: Safari starts a ~7 MB one beside the zone's (iPhone 13, 2026-11-19)
  const peakOf = new Map(peaks), big = fresh.filter((pid) => 4 * (peakOf.get(pid) ?? 0) >= (peaks[0]?.[1] ?? 0));
  const pid = big.length === 1 ? big[0] : active.size === 1 ? [...active][0] : dominant;
  if (pid === null) return { pid, peakBytes: null, controlBytes: null, settledBytes: null, samples: 0, candidatePids: [...active] };
  const series = current.filter((row) => row.pid === pid).sort((a, b) => a.time - b.time);
  const boot = series.filter((row) => controlAt === null || row.time <= controlAt);
  const settled = controlAt === null ? [] : series.filter((row) => row.time >= controlAt && row.time <= controlAt + 30_000).slice(-10);
  const bytes = settled.map((row) => row.physFootprint).sort((a, b) => a - b);
  return {
    pid, samples: series.length, candidatePids: [...active],
    peakBytes: boot.length > 0 ? Math.max(...boot.map((row) => row.physFootprint)) : null,
    controlBytes: controlAt === null ? null : nearestControl(series, controlAt),
    settledBytes: bytes.length === 10 ? (bytes[4] + bytes[5]) / 2 : null,
  };
}

/** @param {FootprintSample[]} rows @param {number} controlAt */
function nearestControl(rows, controlAt) {
  let best = null, distance = 1001;
  for (const row of rows) {
    const gap = Math.abs(controlAt - row.time);
    if (gap >= distance) continue;
    best = row.physFootprint;
    distance = gap;
  }
  return best;
}

/** Keep the raw trace and the export even if this Instruments version has
 * no matching table. Qualification aligns its PID and clock with sysmon.
 * @param {string} trace @param {string} out @param {string} template */
async function exportTrace(trace, out, template) {
  if (!existsSync(trace)) return { trace: null, toc: null, samples: null, error: 'xctrace did not produce a trace' };
  const toc = join(out, 'trace-toc.xml'), samples = join(out, 'trace-samples.xml');
  const run = (/** @type {string[]} */ args, /** @type {string} */ file) => launch(
    ['xcrun', 'xctrace', 'export', '--input', trace, ...args, '--output', file], `${file}.log`).done;
  const contents = await run(['--toc'], toc);
  if (contents.code !== 0) return { trace, toc: null, samples: null, error: contents.error ?? 'xctrace TOC export failed' };
  const filter = template === 'Activity Monitor' ? '@schema="activity-monitor-process-live"' : 'contains(@schema,"gpu") or contains(@schema,"metal")';
  const path = `/trace-toc/run/data/table[${filter} or @schema="device-thermal-state-intervals"]`;
  const result = await run(['--xpath', path], samples);
  return { trace, toc, samples: result.code === 0 ? samples : null, error: result.code === 0 ? null : result.error ?? 'xctrace table export failed' };
}

// Instruments exports a column schema plus shared XML cells referenced by
// id. Keep only selected PIDs, in raw bytes, at each interval's end time.
const ACTIVITY_ROWS = `
import json, sys, xml.etree.ElementTree as ET
from datetime import datetime
toc, samples, *pids = sys.argv[1:]
epoch = datetime.fromisoformat(ET.parse(toc).findtext(".//start-date")).timestamp() * 1000
root = ET.parse(samples).getroot()
output = []
for node in root.findall("node"):
    schema = node.find("schema")
    if schema is None or schema.get("name") != "activity-monitor-process-live":
        continue
    refs = {cell.get("id"): cell.text for cell in node.iter() if cell.get("id")}
    cols = [column.findtext("mnemonic") for column in schema]
    indexes = [cols.index(key) for key in ("start", "duration", "pid", "memory-physical-footprint")]
    for row in node.findall("row"):
        start, duration, pid, size = [row[i].text or refs.get(row[i].get("ref")) for i in indexes]
        if pid in pids and None not in (start, duration, size):
            output.append({"pid": int(pid), "time": epoch + (int(start) + int(duration)) / 1e6, "physFootprint": int(size)})
print(json.dumps(output))
`;

/** @param {{toc:string|null, samples:string|null}|null} trace @param {number[]} pids
 * @returns {{series: FootprintSample[], error: string | null}} */
export function activityMonitor(trace, pids) {
  if (!trace?.toc || !trace.samples || pids.length === 0) return { series: [], error: 'No Activity Monitor export or sysmon PID' };
  try {
    const json = execFileSync('python3', ['-c', ACTIVITY_ROWS, trace.toc, trace.samples, ...pids.map(String)],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const series = JSON.parse(json);
    return { series, error: series.length === 0 ? 'No Activity Monitor sample for the selected PID' : null };
  } catch (error) { return { series: [], error: String(error) }; }
}

/** @param {{udid: string, out: string, seconds: number, trace?: string}} options */
export function startReaders({ udid, out, seconds, trace }) {
  mkdirSync(out, { recursive: true });
  const plan = commands({ udid, out, seconds });
  const sysmon = plan.sysmon.map((command, index) => launch(command, join(out, `sysmon-${index}.log`)));
  const syslogFile = join(out, 'syslog.txt');
  const syslog = launch(['idevicesyslog', '-u', udid], syslogFile);
  const traceFile = join(out, 'device.trace');
  const xctrace = trace === undefined ? null : launch(['xcrun', 'xctrace', 'record', '--template', trace,
    '--device', udid, '--all-processes', '--no-prompt', '--time-limit', `${seconds}s`, '--output', traceFile], join(out, 'xctrace.log'));
  return {
    async stop() {
      const statuses = await Promise.all([...sysmon, syslog, ...(xctrace === null ? [] : [xctrace])].map((reader) => reader.stop()));
      const series = Object.fromEntries(PROCESSES.map((name) => [
        name, readLines(join(out, `sysmon-${name.split('.').at(-1)}.jsonl`)).map(timedSample).filter((row) => row !== null),
      ]));
      const limits = readLines(syslogFile).map(parseSyslog).filter((row) => row !== null);
      return { series, limits, statuses, trace: xctrace === null || trace === undefined ? null : await exportTrace(traceFile, out, trace) };
    },
  };
}

/** @param {{udid: string, out: string, since: number}} options */
export async function pullJetsam({ udid, out, since }) {
  // -k leaves device reports intact. Keep only parsed WebKit readings after
  // this run started. The USB copy can contain private reports from other apps.
  const raw = mkdtempSync(join(out, 'crash-pull-'));
  try {
    const pull = launch(['idevicecrashreport', '-k', '-f', 'JetsamEvent', '-u', udid, raw], join(raw, 'command.log'));
    const result = await Promise.race([pull.done, delay(45_000, null, { ref: false })]);
    if (result === null) {
      await pull.stop();
      throw new Error('idevicecrashreport timed out');
    }
    if (result.code !== 0) throw new Error(result.error ?? `idevicecrashreport exited ${result.code}`);
    return readdirSync(raw, { recursive: true }).map(String).filter((name) => /(?:^|\/)JetsamEvent.*\.ips$/u.test(name)).flatMap((name) => {
      try {
        const report = parseJetsam(readFileSync(join(raw, name), 'utf8'));
        if (!report.date || !(Date.parse(report.date) >= since)) return [];
        const killed = report.killed.filter((entry) => entry.name.includes('WebContent') || entry.name.includes('WebKit.GPU'));
        return killed.length > 0 ? [{ date: report.date, pageSize: report.pageSize, killed }] : [];
      } catch {
        return [];
      }
    });
  } finally {
    rmSync(raw, { recursive: true, force: true });
  }
}
