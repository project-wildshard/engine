// @vitest-environment node
import {expect, test, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {cookUnitGap, expectedCookUnit, hardenDue, hardenGateOf, preparationClientGap, selectCookRelease} from '../src/scripts/release-cook.mjs';

// v0.1.95: a pending reboot (VH5) held the harden that refreshes the box's rebuild.sh, so the cook move ran the pre-lean
// copy and rolled back. Only rows whose fix could touch sshd, ufw or Tailscale hold an unattended apply.
test('a pending reboot does not hold the release harden; an ssh row still does', () => {
  const reboot = ['fail    VH5   running kernel 6.8.0-149-generic; 6.8.0-151-generic is installed (reboot)',
    'fail    VH5   a reboot has been required since 2026-11-26', 'ok      VH6   fail2ban jail sshd', 'summary       2 fail, 1 unknown'].join('\n');
  expect(hardenGateOf(reboot)).toBeNull();
  expect(hardenGateOf(`fail    VH3   sshd PasswordAuthentication yes\n${reboot}`)).toBe('harden --check has 1 fail row(s) (VH3)');
  expect(hardenGateOf('fail    VH5   a reboot has been required')).toBe('harden --check did not finish');
});

const build = 'a'.repeat(40), staging = {tag: `server-staging-${build}`, build};

test('the cook move requires the exact preparation client before touching the box', async () => {
  const read = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, {status: 404}))
    .mockResolvedValueOnce(new Response(null, {status: 200})).mockRejectedValueOnce(new Error('network timeout'));
  const url = `https://github.com/project-wildshard/engine/releases/download/${staging.tag}/preparation-client.tar.gz`;
  expect(await preparationClientGap(build, read)).toContain('returned HTTP 404; wait for');
  expect(await preparationClientGap(build, read)).toBeNull();
  expect(await preparationClientGap(build, read)).toContain('could not verify');
  expect(read).toHaveBeenCalledWith(url, expect.objectContaining({method: 'HEAD', cache: 'no-store'}));
  const cook = readFileSync('src/scripts/release-cook.mjs', 'utf8');
  const main = cook.slice(cook.indexOf('async function main()'), cook.indexOf('\n}\n', cook.indexOf('async function main()')));
  expect(main.indexOf('stop(archiveGap)')).toBeGreaterThan(main.indexOf('await preparationClientGap'));
  expect(main.indexOf('stop(archiveGap)')).toBeLessThan(main.indexOf("const shown = box("));
});

test('staging moves the cook from its signed server tag before a production tag exists', () => {
  expect(selectCookRelease(staging, {tag: 'v0.1.32', build: 'b'.repeat(40)}, {build})).toEqual(staging);
  expect(() => selectCookRelease(staging, staging, {build: 'b'.repeat(40)})).toThrow('exact signed staging');
  expect(() => selectCookRelease({...staging, tag: 'server-production-' + build}, staging, {build})).toThrow('exact signed staging');
});

test('finishing an older production train cannot rewind a cook already following newer staging', () => {
  const production = {tag: 'v0.1.33', build};
  expect(selectCookRelease(staging, production, {tag: 'v0.1.33'})).toEqual(production);
  expect(() => selectCookRelease({...staging, build: 'b'.repeat(40)}, production, {tag: 'v0.1.33'})).toThrow('Cook follows staging');
  expect(() => selectCookRelease(staging, production, {tag: 'v0.1.32'})).toThrow('Cook follows staging');
});

// FAST-RELEASE FR-A11: a release applies its own harden when src/scripts/vps changed since the box's last harden.
test('harden is due when src/scripts/vps changed since the last harden, and only then', () => {
  const applied = 'b'.repeat(40);
  const diff = (paths: string[] | null) => () => paths;
  expect(hardenDue(build, build, diff([])).due).toBe(false);
  expect(hardenDue(applied, build, diff(['src/main.ts', 'docs/server-release.md']))).toEqual({due: false, why: 'no harden input changed since bbbbbbbb'});
  expect(hardenDue(applied, build, diff(['src/scripts/vps/harden-grafana.sh']))).toEqual({due: true, why: '1 harden input(s) changed since bbbbbbbb (src/scripts/vps/harden-grafana.sh)'});
  expect(hardenDue(applied, build, diff(['src/scripts/vps/a', 'src/scripts/vps/b', 'src/scripts/vps/c', 'src/scripts/vps/d'])).why).toContain('4 harden input(s)');
  expect(hardenDue(applied, build, diff(null)).due).toBe(true);
  expect(hardenDue(undefined, build, diff([])).due).toBe(true);
  expect(hardenDue('not-a-commit', build, diff([])).due).toBe(true);
});

test('wildshard-apply stamps the harden release-cook reads', () => {
  const stamp = /const HARDEN_STAMP = '([^']+)'/u;
  const apply = readFileSync('src/scripts/vps/wildshard-apply.mjs', 'utf8'), cook = readFileSync('src/scripts/release-cook.mjs', 'utf8');
  expect(stamp.exec(apply)?.[1]).toBe('/var/lib/wildshard-harden-applied');
  expect(stamp.exec(cook)?.[1]).toBe(stamp.exec(apply)?.[1]);
  // Only a harden that exited 0 writes it, and world-readable, so wildshard-agent reads it without sudo.
  expect(apply).toMatch(/which === 'harden' && run\.status === 0\) \{\s*writeFileSync\(HARDEN_STAMP, `\$\{commit\} \$\{tag\}\\n`, \{ mode: 0o644 \}\)/u);
});

// FAST-RELEASE FR-A25: v0.1.91 moved the cook before the harden refreshed the box's rebuild.sh, so the move wrote the old
// unit (AllowedCPUs=13-15, no CPUWeight) and the staging recook the pack wait waited on ran on 3 CPUs, not FR-A22's 7.
test('the train hardens before the cook move, and the cook move comes before the staging pack wait', () => {
  const cook = readFileSync('src/scripts/release-cook.mjs', 'utf8');
  const main = cook.slice(cook.indexOf('async function main()'), cook.indexOf('\n}\n', cook.indexOf('async function main()')));
  const harden = main.lastIndexOf('await hardenIfDue(tag, production.build, cookBuild, dry);'), move = main.lastIndexOf('moveCook(tag, production.build);');
  expect(harden).toBeGreaterThan(0);
  expect(move).toBeGreaterThan(harden);
  expect(main.indexOf('checkCookUnit();', move)).toBeGreaterThan(move);
  // The move itself runs no harden after it.
  const moveCook = cook.slice(cook.indexOf('function moveCook('), cook.indexOf('\n}\n', cook.indexOf('function moveCook(')));
  expect(moveCook).not.toContain('hardenIfDue');
  // page-release's staging check runs release-cook; the deploy's pack wait (FR-A19) comes only after the check phase.
  const flow = readFileSync('src/scripts/page-release/flow.mjs', 'utf8');
  expect(flow.indexOf("deps.run('node', ['src/scripts/release-cook.mjs', '--staging'")).toBeGreaterThan(0);
  const deploy = readFileSync('src/scripts/page-release/staging-deploy.mjs', 'utf8');
  expect(deploy.indexOf('await waitPacks();')).toBeGreaterThan(deploy.indexOf("await phase('check');"));
});

test('the cook unit check reads rebuild.sh and refuses the v0.1.91 box', () => {
  const rebuild = readFileSync('src/scripts/vps/rebuild.sh', 'utf8');
  const expected = expectedCookUnit(rebuild);
  expect(expected).toEqual({AllowedCPUs: '9-15', CPUWeight: '20', MemoryMax: String(8 * 1024 ** 3)});
  // The box after v0.1.91's harden (read 11-25 18:20 UTC).
  expect(cookUnitGap(expected, 'CPUWeight=[not set]\nAllowedCPUs=13-15\nMemoryMax=8589934592\n'))
    .toBe('AllowedCPUs box 13-15, rebuild.sh 9-15; CPUWeight box [not set], rebuild.sh 20');
  expect(cookUnitGap(expected, 'CPUWeight=20\nAllowedCPUs=9-15\nMemoryMax=8589934592\n')).toBeNull();
  expect(cookUnitGap(expected, '')).toContain('AllowedCPUs box (none)');
  // One MemoryMax: the unit's equals harden's drop-in, which overrides it on the box.
  const apply = readFileSync('src/scripts/vps/harden-apply.sh', 'utf8'), at = apply.indexOf('wildshard-cook.service.d/90-harden.conf');
  const dropIn = /^MemoryMax=(\d+)G$/mu.exec(apply.slice(at, apply.indexOf('\nEOF\n', at)))?.[1];
  expect(String(Number(dropIn) * 1024 ** 3)).toBe(expected.MemoryMax);
  expect(() => expectedCookUnit('CPUWeight=20\n')).toThrow('no COOK_CPUS');
});
