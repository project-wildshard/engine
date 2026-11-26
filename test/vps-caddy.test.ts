// oxlint-disable-next-line import/no-nodejs-modules -- The real script prints the Caddyfile it would write.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

// VPS-HARDENING VH9 and D7: both rooms sites answer /up the same way, so Sentry can watch production and staging from
// outside the box. `--print` renders the file and stops before any root step.
const CADDY = resolve('src/scripts/vps/harden-caddy.sh');

function render(addresses: string): string {
  const run = spawnSync('bash', [CADDY, '--print', addresses], { encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

/** One site's block, from its address line to the closing brace at the start of a line. */
function site(caddyfile: string, host: string): string {
  const start = caddyfile.indexOf(`https://${host} {\n`);
  expect(start, host).toBeGreaterThanOrEqual(0);
  return caddyfile.slice(start, caddyfile.indexOf('\n}\n', start) + 2);
}

/** The `handle /up` block, with the channel's port taken out. */
function up(block: string, port: number): string {
  const start = block.indexOf('\thandle /up {\n');
  expect(start).toBeGreaterThanOrEqual(0);
  const body = block.slice(start, block.indexOf('\n\t}\n', start) + 3);
  expect(body).toContain(`reverse_proxy 127.0.0.1:${port} {`);
  return body.replace(`127.0.0.1:${port}`, '127.0.0.1:PORT');
}

test('production and staging both answer /up from their own /health, and nothing else', () => {
  const caddyfile = render('203.0.113.7 2001:db8::7');
  expect(caddyfile).toContain('default_bind 203.0.113.7 2001:db8::7');
  const production = site(caddyfile, 'rooms.wildshard.io'), staging = site(caddyfile, 'rooms-staging.wildshard.io');
  // The same block on both sites: a bare 200 or 503, never a body, a build or a serial.
  expect(up(staging, 8791)).toBe(up(production, 8790));
  for (const block of [production, staging]) {
    expect(block).toContain('rewrite * /health');
    expect(block).toMatch(/handle_response @healthy \{\n\t+respond 200\n/u);
    expect(block).toMatch(/handle_response \{\n\t+respond 503\n/u);
    // /health itself stays tailnet-only (D7): no route names it, so it falls to the 404.
    expect(block).not.toMatch(/handle \/health|path \/health/u);
    expect(block).toMatch(/handle \{\n\t+respond 404\n/u);
    expect(block).toContain('respond @up 503');
  }
  // Staging's /up reads staging, never production.
  expect(staging).not.toContain('8790');
  expect(production).not.toContain('8791');
});

test('--print without addresses stops', () => {
  const run = spawnSync('bash', [CADDY, '--print'], { encoding: 'utf8' });
  expect(run.status).toBe(1);
  expect(run.stdout).toContain('usage: harden-caddy.sh --print <addresses>');
});

test('VH9: Caddy lets in only the three game pages (the server unit ALLOWED_ORIGINS; OFF-VERCEL OV9)', () => {
  const caddyfile = render('203.0.113.7');
  const patterns = [...caddyfile.matchAll(/@foreign not header_regexp Origin (\S+)/gu)].map(match => match[1]);
  expect(patterns.length).toBeGreaterThan(0);
  for (const pattern of patterns) expect(pattern).toBe('^https://(play|staging|preview)\\.wildshard\\.io$');
});

test('MMO-PLAN MP2.5a: both sites pass a game page\'s account export and delete to their own server, and nothing past them', () => {
  const caddyfile = render('203.0.113.7');
  for (const [host, port] of [['rooms.wildshard.io', 8790], ['rooms-staging.wildshard.io', 8791]] as const) {
    const block = site(caddyfile, host), start = block.indexOf('\thandle @account {\n');
    expect(block, host).toContain('\t@account path /account/export /account/delete\n');
    expect(start, host).toBeGreaterThanOrEqual(0);
    const body = block.slice(start, block.indexOf('\n\t}\n', start) + 3);
    expect(body, 'another site\'s page is refused first').toMatch(/^\thandle @account \{\n\t\trespond @foreign 403\n/u);
    expect(body).toContain(`reverse_proxy 127.0.0.1:${String(port)} {`);
    expect(body).toContain('header_up -CF-Connecting-IP');
  }
});

test('ZONE-SELECT-SERVED ZS14: both sites pass exactly GET /zone-select and POST/OPTIONS /zone-select/enter to their own door', () => {
  const caddyfile = render('203.0.113.7');
  for (const [host, port] of [['rooms.wildshard.io', 8790], ['rooms-staging.wildshard.io', 8791]] as const) {
    const block = site(caddyfile, host);
    expect(block, host).toContain('\t@zone_select {\n\t\tmethod GET\n\t\tpath /zone-select\n\t}\n');
    expect(block, host).toContain('\t@zone_select_enter {\n\t\tmethod POST OPTIONS\n\t\tpath /zone-select/enter\n\t}\n');
    const start = block.indexOf('\thandle @zone_select_enter {\n');
    const body = block.slice(start, block.indexOf('\n\t}\n', start) + 3);
    expect(body, 'another site\'s page is refused first').toMatch(/^\thandle @zone_select_enter \{\n\t\trespond @foreign 403\n\t\theader >Cache-Control no-store\n/u);
    expect(body).toContain(`reverse_proxy 127.0.0.1:${String(port)} {`);
    expect(block.match(/path \/zone-select\S*/gu), 'no wildcard under /zone-select').toEqual(['path /zone-select', 'path /zone-select/enter']);
  }
});
