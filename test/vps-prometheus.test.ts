// oxlint-disable-next-line import/no-nodejs-modules -- The real script prints what it writes, and runs its settings step on a made-up /etc.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- A made-up /etc/wildshard in the checkout's tmp/.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

// SERVER-CELLS SC2: the box's Prometheus, loopback only, 15 days, no remote write, scraping both channels' METRICS_PORT and the
// node. `--print` renders every file and stops before any root step; `--settings` runs only the METRICS_PORT step, never as root.
const SCRIPT = resolve('scripts/vps/harden-prometheus.sh'), CONFIG = resolve('scripts/vps/wildshard-config');
const made: string[] = [];
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }); });

function files(): Readonly<Record<string, string>> {
  const run = spawnSync('bash', [SCRIPT, '--print'], { encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  const out: Record<string, string> = {};
  for (const part of run.stdout.split(/^# --- /mu).slice(1)) {
    const newline = part.indexOf('\n');
    out[part.slice(0, newline)] = part.slice(newline + 1);
  }
  return out;
}

test('Prometheus and the node exporter listen on loopback alone, keep 15 days and write nothing out', () => {
  const all = files();
  expect(Object.keys(all)).toEqual(['/etc/prometheus/wildshard.yml', '/etc/systemd/system/prometheus.service.d/90-wildshard.conf',
    '/etc/systemd/system/prometheus-node-exporter.service.d/90-wildshard.conf']);
  const prometheus = all['/etc/systemd/system/prometheus.service.d/90-wildshard.conf'] ?? '';
  const node = all['/etc/systemd/system/prometheus-node-exporter.service.d/90-wildshard.conf'] ?? '';
  // Each drop-in clears the packaged command line ($ARGS from /etc/default) and replaces it whole.
  for (const dropin of [prometheus, node]) {
    const starts = dropin.split('\n').filter(row => row.startsWith('ExecStart='));
    expect(starts[0]).toBe('ExecStart=');
    expect(starts).toHaveLength(2);
    expect(starts[1]).not.toContain('$');
  }
  expect(prometheus).toContain('--web.listen-address=127.0.0.1:9090');
  expect(prometheus).toContain('--storage.tsdb.retention.time=15d');
  expect(prometheus).toContain('--config.file=/etc/prometheus/wildshard.yml');
  expect(node).toContain('--web.listen-address=127.0.0.1:9100');
  const config = all['/etc/prometheus/wildshard.yml'] ?? '';
  expect(config).not.toMatch(/remote_write|remote_read|alerting:|https?:\/\//u);
  expect(config).toContain('scrape_interval: 15s');
  // Every target is on loopback: production's and staging's /metrics, and the node.
  const targets = [...config.matchAll(/targets: \['([^']+)'\]/gu)].map(match => match[1]);
  expect(targets).toEqual(['127.0.0.1:9790', '127.0.0.1:9791', '127.0.0.1:9100']);
  expect(config).toMatch(/127\.0\.0\.1:9790'\]\n\s+labels:\n\s+channel: production\n/u);
  expect(config).toMatch(/127\.0\.0\.1:9791'\]\n\s+labels:\n\s+channel: staging\n/u);
});

test("the scraped ports are the ones wildshard-config pins for each channel, and harden.sh runs the step", () => {
  const helper = readFileSync(CONFIG, 'utf8'), script = readFileSync(SCRIPT, 'utf8');
  expect(helper).toContain("'production': {'port': 8790, 'cpus': 9, 'host': 0, 'metrics': 9790}");
  expect(helper).toContain("'staging': {'port': 8791, 'cpus': 4, 'host': 1, 'metrics': 9791}");
  expect(script).toContain('PRODUCTION_METRICS=9790 STAGING_METRICS=9791');
  expect(readFileSync('scripts/vps/harden-apply.sh', 'utf8')).toContain('\n"$HERE/harden-prometheus.sh"\n');
  // harden.sh --check fails a metrics port off loopback, the tailnet included.
  expect(readFileSync('scripts/vps/harden.sh', 'utf8')).toContain("grep -E ':(9090|9100|9790|9791)$'");
});

function etc(settings: Readonly<Record<string, string>>): string {
  mkdirSync('tmp/vps-prometheus', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vps-prometheus/run-')); made.push(root);
  mkdirSync(join(root, 'etc/wildshard'), { recursive: true });
  for (const [name, text] of Object.entries(settings)) writeFileSync(join(root, 'etc/wildshard', name), text);
  return root;
}
function settings(root: string) {
  const run = spawnSync('bash', [SCRIPT, '--settings'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', WILDSHARD_PROMETHEUS_TEST_ROOT: root } });
  return { status: run.status, out: run.stdout + run.stderr };
}
const read = (root: string, name: string) => readFileSync(join(root, 'etc/wildshard', name), 'utf8');

test("METRICS_PORT is added once to each channel's settings, a rerun changes nothing, and an agent's own value stays", () => {
  const root = etc({ 'staging.settings': '# header\nALLOWED_ORIGINS=https://staging.wildshard.io' });
  const first = settings(root);
  expect(first.status, first.out).toBe(0);
  expect(read(root, 'staging.settings')).toBe('# header\nALLOWED_ORIGINS=https://staging.wildshard.io\nMETRICS_PORT=9791\n');
  expect(read(root, 'production.settings')).toMatch(/^# MMO-SERVER-PLAN MS3\.5[^\n]*\n# [^\n]*\nMETRICS_PORT=9790\n$/u);
  expect(statSync(join(root, 'etc/wildshard/staging.settings')).mode & 0o777).toBe(0o640);
  expect(first.out).toContain('doing   SC2   staging METRICS_PORT=9791');
  const before = [read(root, 'staging.settings'), read(root, 'production.settings')];
  const again = settings(root);
  expect(again.status, again.out).toBe(0);
  expect(again.out).not.toContain('doing');
  expect([read(root, 'staging.settings'), read(root, 'production.settings')]).toEqual(before);
  // wildshard-config reads the row the step wrote, and takes only the channel's own port or blank.
  const config = (...args: string[]) => spawnSync('python3', [CONFIG, ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', WILDSHARD_CONFIG_TEST_ROOT: root, WILDSHARD_CONFIG_TEST_RUNNING: '1' } });
  expect(config('show', 'staging').stdout).toBe('ALLOWED_ORIGINS=https://staging.wildshard.io\nMETRICS_PORT=9791\n');
  expect(config('set', 'staging', 'METRICS_PORT', '9790').stderr).toContain('METRICS_PORT must be');
  expect(config('set', 'staging', 'METRICS_PORT', '9090').stderr).toContain('METRICS_PORT must be');
  expect(config('set', 'staging', 'METRICS_PORT', '').status).toBe(0);
  // Turned off by an agent, it stays off through the next harden.
  expect(settings(root).out).not.toContain('doing');
  expect(read(root, 'staging.settings')).toContain('METRICS_PORT=\n');
  expect(config('set', 'production', 'METRICS_PORT', '9790').stderr).toContain('needs --production');
});

test('--settings without a test root stops, and an unknown argument stops', () => {
  const bare = spawnSync('bash', [SCRIPT, '--settings'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } });
  expect(bare.status).toBe(1);
  expect(bare.stdout).toContain("--settings is the engine test's");
  const odd = spawnSync('bash', [SCRIPT, '--apply'], { encoding: 'utf8' });
  expect(odd.status).toBe(1);
  expect(odd.stdout).toContain('usage: harden-prometheus.sh');
});
