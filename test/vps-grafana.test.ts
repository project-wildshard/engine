// oxlint-disable-next-line import/no-nodejs-modules -- The real scripts print what they write; setup-state reads a Serve state.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The checked-in dashboard and the server's own metric names.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// MMO-OBSERVABILITY OB3/OB7 (meta docs/plans/MMO-OBSERVABILITY-PLAN.md): Grafana on loopback, reached only through a tailnet-only
// Serve route, sending nothing off the box and letting nobody log in; and a dashboard whose every query reads a metric something on
// the box exports.
const host = 'wildshard.tailb41b20.ts.net';
function files(): Readonly<Record<string, string>> {
  const run = spawnSync('bash', ['scripts/vps/harden-grafana.sh', '--print'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', WILDSHARD_GRAFANA_TEST_HOST: host } });
  expect(run.status, run.stderr).toBe(0);
  const out: Record<string, string> = {};
  for (const part of run.stdout.split(/^# --- /mu).slice(1)) { const newline = part.indexOf('\n'); out[part.slice(0, newline)] = part.slice(newline + 1); }
  return out;
}

test('OB3: Grafana listens on loopback, phones nowhere, has no admin or login, and reads only the box Prometheus', () => {
  const all = files(), ini = all['/etc/wildshard-grafana/grafana.ini'] ?? '';
  expect(Object.keys(all)).toEqual(['/etc/wildshard-grafana/grafana.ini', '/etc/wildshard-grafana/provisioning/datasources/wildshard.yaml',
    '/etc/wildshard-grafana/provisioning/dashboards/wildshard.yaml', '/etc/systemd/system/wildshard-grafana.service', 'serve']);
  for (const line of ['http_addr = 127.0.0.1', 'http_port = 3000', `root_url = https://${host}:10000/`, 'disable_initial_admin_creation = true', 'disable_login_form = true',
    'org_role = Viewer', 'allow_sign_up = false', 'reporting_enabled = false', 'check_for_updates = false', 'check_for_plugin_updates = false',
    'preinstall_disabled = true', 'external_enabled = false', 'news_feed_enabled = false']) expect(ini.split('\n'), line).toContain(line);
  expect(ini).not.toMatch(/org_role = (Editor|Admin)|admin_password/u);
  const datasource = all['/etc/wildshard-grafana/provisioning/datasources/wildshard.yaml'] ?? '';
  expect(datasource).toContain('url: http://127.0.0.1:9090');
  expect([...datasource.matchAll(/https?:\/\/[^\s]+/gu)].map(match => match[0])).toEqual(['http://127.0.0.1:9090']);
  expect(all['/etc/wildshard-grafana/provisioning/dashboards/wildshard.yaml']).toContain('allowUiUpdates: false');
  const unit = all['/etc/systemd/system/wildshard-grafana.service'] ?? '';
  for (const line of ['DynamicUser=yes', 'MemoryMax=512M', 'CPUQuota=25%', 'ProtectSystem=strict', 'NoNewPrivileges=yes']) expect(unit).toContain(line);
  // Serve, never Funnel, and only the one port Serve allows besides the two /health routes.
  expect(all['serve']).toBe('tailscale serve --bg --yes --https=10000 http://127.0.0.1:3000\n');
  const script = readFileSync('scripts/vps/harden-grafana.sh', 'utf8');
  expect(script).not.toMatch(/tailscale funnel/u);
  expect(script).toMatch(/^VERSION=\d+\.\d+\.\d+\nSHA256=[0-9a-f]{64}$/mu);
  expect(script).toContain('sha256sum -c --status');
  // Last in harden-apply and never fatal: a dashboard that can't install never holds back the box's own hardening.
  const apply = readFileSync('scripts/vps/harden-apply.sh', 'utf8');
  expect(apply).toContain('if ! "$HERE/harden-grafana.sh"; then say warn OB3');
  expect(apply.indexOf('"$HERE/harden-caddy.sh"')).toBeLessThan(apply.indexOf('"$HERE/harden-grafana.sh"'));
});

test('OB3: setup-state takes the dashboard route as tailnet-only Serve, never asks for it, and refuses it as Funnel', () => {
  const run = (input: unknown, ...args: string[]) => spawnSync(process.execPath, ['scripts/vps/setup-state.mjs', 'network', host, ...args], { encoding: 'utf8', input: JSON.stringify(input) });
  const route = (port: string) => ({ Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } });
  const owned = { TCP: { '443': { HTTPS: true }, '8443': { HTTPS: true }, '8790': { HTTP: true } },
    Web: { [`${host}:443`]: route('8790'), [`${host}:8443`]: route('8791'), [`${host}:8790`]: route('8790') } };
  const withGrafana = { TCP: { ...owned.TCP, '10000': { HTTPS: true } }, Web: { ...owned.Web, [`${host}:10000`]: route('3000') } };
  expect(run(owned, '--complete').status, 'setup never needs the dashboard').toBe(0);
  const both = run(withGrafana, '--complete');
  expect(both.status, both.stderr).toBe(0);
  expect(both.stdout).toContain('ok tailnet-only Serve port 10000 to loopback 3000');
  expect(run({ ...withGrafana, AllowFunnel: { [`${host}:10000`]: true } }).status).not.toBe(0);
  expect(run({ ...withGrafana, Web: { ...withGrafana.Web, [`${host}:10000`]: route('9090') } }).status, 'only Grafana, never Prometheus itself').not.toBe(0);
});

test('OB7: the dashboard is generated, and every metric it reads is exported by the server or the box exporters', () => {
  const stale = spawnSync(process.execPath, ['scripts/vps/grafana/dashboard.mjs', '--check'], { encoding: 'utf8' });
  expect(stale.status, stale.stderr).toBe(0);
  const board = JSON.parse(readFileSync('scripts/vps/grafana/wildshard.json', 'utf8')) as { uid: string; graphTooltip: number; time: { from: string }; panels: { type: string }[] };
  expect(board.uid).toBe('wildshard-lag');
  expect(board.graphTooltip, 'a shared crosshair: every suspect on one time axis').toBe(1);
  expect(board.time.from).toBe('now-24h');
  expect(board.panels.filter(panel => panel.type === 'timeseries').length).toBeGreaterThan(30);
  const server = ['src/server/host/dedicated/serverMetrics.ts'].map(path => readFileSync(path, 'utf8')).join('\n');
  // The metrics client's defaults (nodejs_*, process_*) and the exporters' (node_*, namedprocess_*) are checked by prefix and on the box.
  const listed = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('./scripts/vps/grafana/dashboard.mjs'); console.log(JSON.stringify(m.metricNames()));"], { encoding: 'utf8' });
  const names = JSON.parse(listed.stdout) as string[];
  expect(names.length).toBeGreaterThan(40);
  for (const name of names) {
    if (!name.startsWith('wildshard_')) { expect(name).toMatch(/^(node|namedprocess_namegroup|nodejs|process)_/u); continue; }
    const family = name.replace(/_(bucket|sum|count)$/u, '');
    expect(server, name).toContain(`'${family}'`);
  }
});

// OB13 (OB9's staging drop): a counter series is born at its first event, so `increase()` alone reads the first close of a reason,
// actor or device as 0. Every per-minute read of a counter whose label sets appear mid-life counts a newborn series' value too.
test('OB13: the closes, reconnects and refusals panels count a series born in the last minute', () => {
  const board = JSON.parse(readFileSync('scripts/vps/grafana/wildshard.json', 'utf8')) as { panels: { targets?: { expr: string }[] }[]; annotations: { list: { expr?: string }[] } };
  const exprs = [...board.panels.flatMap(panel => (panel.targets ?? []).map(target => target.expr)), ...board.annotations.list.flatMap(row => (row.expr === undefined ? [] : [row.expr]))];
  const born = ['wildshard_socket_closes_total', 'wildshard_client_reconnects_total', 'wildshard_door_refusals_total'];
  const reads = exprs.filter(expr => born.some(name => expr.includes(`increase(${name}`)));
  expect(reads.length, 'the closes, both reconnects panels, the refusals and the storm marker').toBe(5);
  for (const expr of reads) for (const name of born) {
    const increases = expr.split(`increase(${name}`).length - 1;
    if (increases === 0) continue;
    expect(expr.split(new RegExp(`${name}\\{[^}]*\\} offset 1m`, 'u')).length - 1, `${name} in ${expr}`).toBe(increases);
  }
});
