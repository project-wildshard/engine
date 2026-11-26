// Meta QA 11-24 row 43 (MA13, SHARD-COMPAT SP1b5b): the box half of the record pass. rebuild.sh installs the recorder
// (the author's `wildshard`, pinned, with its WebKit) and this build's preparation client beside the cook, and the
// wildshard-cook unit names them, so the worker's record pass is on: a render change ends `cooked, prepared by cook`.
// oxlint-disable-next-line import/no-nodejs-modules -- Run rebuild.sh's own functions with fake paths.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Checkout-relative scratch, never privileged paths.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Checkout-relative scratch, never privileged paths.
import {join, resolve} from 'node:path';
import {afterEach, expect, it} from 'vitest';
import {recordPorts} from '../src/cook/game/recordPass';

const source = readFileSync('src/scripts/vps/rebuild.sh', 'utf8');
const definition = (name: string): string => {
  const start = source.indexOf(`${name}() {`);
  if (start === -1) throw new Error(`Missing ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const unit = source.slice(source.indexOf('wildshard-cook.service" 644'), source.indexOf('WantedBy=multi-user.target', source.indexOf('wildshard-cook.service" 644')));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

/** The unit's Environment lines with the script's paths filled in, as systemd hands them to the worker. */
function unitEnv(vars: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of unit.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('Environment=')) continue;
    const body = line.slice('Environment='.length).replace(/^'(.*)'$/u, '$1').replace(/\$(\w+)/gu, (_, name: string) => vars[name] ?? `$${name}`);
    const at = body.indexOf('=');
    if (!body.slice(0, at).includes(' ')) env[body.slice(0, at)] = body.slice(at + 1);
  }
  return env;
}

it('the unit turns the record pass on: recorder, client, WebKit, canary and a loopback-only sandbox', () => {
  const vars = {COOK_HOME: '/var/lib/wildshard-cook', COOK_LIB: '/usr/local/lib/wildshard-cook', RECORDER: '/usr/local/lib/wildshard-cook/recorder',
    PREPARATION: '/usr/local/lib/wildshard-cook/preparation-client'};
  const env = unitEnv(vars), lines: string[] = [];
  const pass = recordPorts(env, 'renderer-x', '/var/lib/wildshard-cook/scratch', line => { lines.push(line); });
  expect('off' in pass ? pass.off : 'on').toBe('on');
  if ('off' in pass) return;
  expect(pass.canary).toBe('brasscap-mesa');
  expect(pass.ports.sidecars).toBe('/var/lib/wildshard-cook/sidecars');
  expect(env['COOK_RECORDER']).toBe('["/usr/local/lib/wildshard-cook/recorder/node_modules/.bin/wildshard"]');
  expect(env['COOK_PREPARATION_CLIENT']).toBe(vars.PREPARATION);
  expect(env['PLAYWRIGHT_BROWSERS_PATH']).toBe('/usr/local/lib/wildshard-cook/recorder/browsers');
  expect(JSON.parse(env['COOK_RECORD_WRAP'] ?? '[]')).toEqual(['/usr/local/lib/wildshard-cook/unshare', '--user', '--map-root-user', '--net', '/usr/local/lib/wildshard-cook/lo-up']);
  // the cook's own jobs keep no network at all
  expect(JSON.parse(env['COOK_JOB_WRAP'] ?? '[]')).toEqual(['/usr/local/lib/wildshard-cook/unshare', '--user', '--map-root-user', '--net']);
});

it('the recorder and the client install only with a ready cook, after its source, and lo-up raises loopback first', () => {
  const ready = source.indexOf('if [ "$COOK_READY" = 1 ]; then\n  if [ "$CHECK" = 0 ] && ! have_cook_source');
  const recorder = source.indexOf('step "cook recorder'), client = source.indexOf('step "cook preparation client');
  expect(ready).toBeGreaterThan(0);
  expect(recorder).toBeGreaterThan(source.indexOf('step "cook source readable by', ready));
  expect(client).toBeGreaterThan(recorder);
  expect(source).toMatch(/^RECORDER_CLI=\d+\.\d+\.\d+ RECORDER_PLAYWRIGHT=\d+\.\d+\.\d+ /mu);
  expect(definition('make_recorder')).toContain('--ignore-scripts');
  expect(definition('make_preparation')).toContain('/server-staging-$COOK_BUILD/preparation-client.tar.gz');
  expect(source).toContain('ip link set lo up && exec "$@"');
});

it('have_preparation is true only for this build\'s unpacked client', () => {
  mkdirSync('tmp', {recursive: true});
  const root = mkdtempSync(resolve('tmp/vps-cook-recorder-')); roots.push(root);
  const run = (build: string): number | null => spawnSync('bash', ['-c', `PREPARATION=${join(root, 'client')} COOK_BUILD=${build}\n${definition('have_preparation')}\nhave_preparation`]).status;
  expect(run('abc')).not.toBe(0);
  mkdirSync(join(root, 'client'));
  writeFileSync(join(root, 'client/index.html'), '<!doctype html>');
  writeFileSync(join(root, 'client/.installed'), 'abc\n');
  expect(run('abc')).toBe(0);
  expect(run('def')).not.toBe(0);
});
