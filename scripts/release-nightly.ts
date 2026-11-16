// TC22/J370: new nightly failures hold the real release path. J167's
// any-red qualification remains a separate manual check until a green night.
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';

interface Latest {id: number; head_sha: string; status: string; conclusion: string; event: string}
interface Report {version: number; run: string; sha: string; pins: string; testList: string;
  failures: {key: string}[]; newFailures: string[]}

export function requireNoNewFailures(value: unknown, latest: Latest): void {
  const report = value as Partial<Report> | null;
  if (report === null || typeof report !== 'object' || report.version !== 2 ||
    !Number.isSafeInteger(latest.id) || latest.id < 1 || latest.status !== 'completed' || latest.event !== 'schedule' ||
    !['success', 'failure'].includes(latest.conclusion) || !/^[a-f0-9]{40}$/u.test(latest.head_sha) ||
    report.run !== String(latest.id) || report.sha !== latest.head_sha ||
    typeof report.pins !== 'string' || !/^[a-f0-9]{64}$/u.test(report.pins) ||
    typeof report.testList !== 'string' || !/^[a-f0-9]{64}$/u.test(report.testList) ||
    !Array.isArray(report.failures) || report.failures.some(row => row === null || typeof row !== 'object' || typeof row.key !== 'string') ||
    !Array.isArray(report.newFailures) || report.newFailures.some(key => typeof key !== 'string' || key.length === 0 || !report.failures?.some(row => row.key === key))) {
    throw new Error('TC22: latest completed hosted nightly verdict is missing, incomplete or mismatched; release held');
  }
  if (report.newFailures.length > 0) throw new Error(`TC22: new nightly failures; release held: ${report.newFailures.join(', ')}`);
}

export function checkReleaseNightly(): void {
  const latest = JSON.parse(execFileSync('gh', ['api',
    'repos/project-wildshard/engine/actions/workflows/nightly.yml/runs?branch=main&event=schedule&status=completed&per_page=1',
    '--jq', '.workflow_runs[0]'], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024})) as Latest | null;
  if (latest === null || typeof latest !== 'object' || !Number.isSafeInteger(latest.id) || latest.id < 1)
    throw new Error('TC22: no completed hosted nightly; release held');
  const parent = resolve('tmp/release-nightly');
  mkdirSync(parent, {recursive: true});
  const folder = mkdtempSync(join(parent, 'verdict-'));
  try {
    execFileSync('gh', ['run', 'download', String(latest.id), '--repo', 'project-wildshard/engine',
      '--name', 'nightly-verdict', '--dir', folder], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024});
    requireNoNewFailures(JSON.parse(readFileSync(join(folder, 'verdict.json'), 'utf8')), latest);
    console.log(`TC22: nightly ${latest.id} has no new failures; J167 any-red qualification still requires the manual check`);
  } finally {rmSync(folder, {recursive: true, force: true});}
}
