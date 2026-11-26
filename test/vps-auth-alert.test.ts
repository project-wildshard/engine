// oxlint-disable-next-line import/no-nodejs-modules -- The real alert script, run as the developer with its print switch.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Reads the script out of harden-apply.sh.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// SENTRY-TRIAGE S16: an SSH login over the tailnet is our own operator or agent (WILDSHARD-SERVER-2, -4: noise), so the box's
// wildshard-alert sends nothing for it. Logins from anywhere else, sudo, the console and fail2ban's bans (the failed logins)
// still report. The script is the one harden-apply.sh installs; WILDSHARD_ALERT_PRINT prints the line instead of sending it.
const harden = readFileSync('src/scripts/vps/harden-apply.sh', 'utf8');
const script = /put \/usr\/local\/sbin\/wildshard-alert 755 root:root VH14 <<'EOF'\n([\s\S]*?)\nEOF/u.exec(harden)?.[1] ?? '';

/** What the alert would send for this PAM session (or argument), or '' when it sends nothing. */
function alert(env: Readonly<Record<string, string>>, ...args: string[]): string {
  const run = spawnSync('bash', ['-c', script, 'wildshard-alert', ...args], { encoding: 'utf8', env: { WILDSHARD_ALERT_PRINT: '1', ...env } });
  expect(run.status).toBe(0);
  return run.stdout.trim();
}
const ssh = (rhost: string, type = 'open_session') => alert({ PAM_TYPE: type, PAM_SERVICE: 'sshd', PAM_USER: 'agent', PAM_RHOST: rhost });

test('the box installs one alert script, and it says it is S16\'s', () => {
  expect(script).toContain('SENTRY-TRIAGE S16');
});

test('an SSH login over the tailnet sends nothing, at either end of 100.64.0.0/10 and in its IPv6 range', () => {
  for (const rhost of ['100.64.0.1', '100.69.1.2', '100.70.3.4', '100.99.5.6', '100.100.7.8', '100.119.1.1', '100.127.255.254', 'fd7a:115c:a1e0::1', 'FD7A:115C:A1E0:ab12::9']) {
    expect(ssh(rhost), rhost).toBe('');
  }
});

test('an SSH login from any other address still reports, the neighbours of the tailnet range included', () => {
  for (const rhost of ['203.0.113.7', '100.63.255.255', '100.128.0.1', '10.0.0.5', '2001:db8::1', 'fd7a:115c:a1e1::1']) {
    expect(ssh(rhost), rhost).toBe(`sshd: agent from ${rhost}`);
  }
});

test('sudo and the console still report from the tailnet, a fail2ban ban always reports, and only session opens count', () => {
  expect(alert({ PAM_SERVICE: 'sudo', PAM_USER: 'root', PAM_RUSER: 'agent', PAM_RHOST: '100.100.7.8' })).toBe('sudo: root (by agent) from 100.100.7.8');
  expect(alert({ PAM_SERVICE: 'login', PAM_USER: 'raynos' })).toBe('login: raynos from the box');
  expect(alert({ PAM_SERVICE: 'sshd', PAM_RHOST: '100.100.7.8' }, 'fail2ban sshd banned 100.100.7.8 after 5 tries')).toBe('fail2ban sshd banned 100.100.7.8 after 5 tries');
  expect(ssh('203.0.113.7', 'close_session')).toBe('');
});
