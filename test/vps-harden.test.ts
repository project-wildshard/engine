// oxlint-disable-next-line import/no-nodejs-modules -- The real script, on a made-up box.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- A made-up root filesystem and stub commands in the checkout's tmp/.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

// VPS-HARDENING VH1: `harden.sh --check` against the box the 2026-11-09 audit found, as stub commands and a made-up root
// filesystem. Its container proof is scripts/vps-harden-proof.sh; it never runs on the VPS from here.
const HARDEN = resolve('scripts/vps/harden.sh');
const REAL = ['bash', 'awk', 'grep', 'sed', 'sort', 'find', 'cat', 'tr', 'cut', 'wc', 'head', 'tail', 'basename', 'date', 'hostname', 'uniq', 'python3'];
const made: string[] = [];
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }); });

/** The audited box: what each command answered, or would have with sudo. */
const TODAY: Readonly<Record<string, string>> = {
  getent: `case "$1 \${2:-}" in 'group sudo') echo 'sudo:x:27:raynos,matt' ;; 'group docker') echo 'docker:x:999:clawdbot,matt,raynos' ;;
  'passwd ') printf 'root:x:0:0::/root:/bin/bash\\nraynos:x:1000:1000::/home/raynos:/bin/bash\\nclawdbot:x:1001:1001::/home/clawdbot:/bin/bash\\nmatt:x:1002:1002::/home/matt:/bin/bash\\n' ;; *) exit 2 ;; esac`,
  snap: `[ "$1 $2" = 'list ollama' ]`,
  ss: `printf 'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*\\nLISTEN 0 4096 [::]:22 [::]:*\\nLISTEN 0 4096 127.0.0.1:11434 0.0.0.0:*\\nLISTEN 0 511 127.0.0.1:8790 0.0.0.0:*\\nLISTEN 0 511 127.0.0.1:8791 0.0.0.0:*\\n'`,
  sshd: `printf 'passwordauthentication no\\npermitrootlogin no\\nkbdinteractiveauthentication no\\nx11forwarding yes\\nmaxauthtries 6\\n'`,
  ufw: `printf 'Status: active\\nDefault: deny (incoming), allow (outgoing), deny (routed)\\n\\nTo                         Action      From\\n--                         ------      ----\\n22/tcp                     ALLOW IN    Anywhere\\n22/tcp (v6)                ALLOW IN    Anywhere (v6)\\n'`,
  uname: `echo 6.8.0-139-generic`,
  'fail2ban-client': `printf 'Status\\n|- Number of jail:\\t1\\n\`- Jail list:\\tsshd\\n'`,
  systemctl: `case "$1" in cat) case "$2" in wildshard-server@*) exit 0 ;; *) exit 1 ;; esac ;; show) echo 'Environment=WILDSHARD_HOME=/var/lib/wildshard/production RELEASE_CHANNEL=production' ;; esac`,
  'systemd-analyze': `echo "→ Overall exposure level for $3: 8.3 EXPOSED"`,
  ps: `echo wildshard; echo raynos`,
  nft: `printf 'table inet filter {\\n chain input { tcp dport 22 accept }\\n}\\n'`,
  stat: `echo '640 root:wildshard'`,
  sysctl: `case "$2" in net.ipv4.ip_forward|net.ipv4.conf.all.send_redirects|net.ipv4.conf.default.send_redirects|net.ipv4.conf.all.accept_redirects|net.ipv4.tcp_syncookies|kernel.dmesg_restrict|kernel.kptr_restrict|kernel.yama.ptrace_scope|net.ipv6.conf.all.accept_redirects|net.ipv6.conf.default.accept_redirects|net.ipv4.conf.default.accept_redirects) echo 1 ;;
  fs.suid_dumpable|kernel.unprivileged_bpf_disabled) echo 2 ;; *) echo 0 ;; esac`,
  id: `if [ "$1" = postgres ]; then exit 1; fi; echo "\${HARDEN_TEST_UID:-0}"`,
};

function box(commands: Readonly<Record<string, string>>, more: Readonly<Record<string, string>> = {}): { readonly root: string; readonly bin: string } {
  mkdirSync('tmp/vps-harden', { recursive: true });
  const top = mkdtempSync(resolve('tmp/vps-harden/box-')); made.push(top);
  const root = join(top, 'root'), bin = join(top, 'bin');
  mkdirSync(bin);
  // A stub replaces a real tool; never write through a link to the real one.
  for (const name of REAL.filter(tool => !(tool in commands))) { const at = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim(); if (at !== '') symlinkSync(at, join(bin, name)); }
  for (const [name, body] of Object.entries(commands)) { writeFileSync(join(bin, name), `#!${join(bin, 'bash')}\n${body}\n`); chmodSync(join(bin, name), 0o755); }
  const files: Readonly<Record<string, string>> = {
    'boot/vmlinuz-6.8.0-139-generic': '', 'boot/vmlinuz-6.8.0-147-generic': '', 'var/run/reboot-required': '*** System restart required ***\n',
    'etc/apt/apt.conf.d/50unattended-upgrades': 'Unattended-Upgrade::Allowed-Origins {\n  "${distro_id}:${distro_codename}-security";\n};\n// Unattended-Upgrade::Automatic-Reboot "true";\n',
    'etc/sudoers.d/90-cloud-init-users': '# Created by cloud-init\nmatt ALL=(ALL) NOPASSWD:ALL\n',
    'var/log/auth.log': 'Nov 9 sshd[1]: Accepted publickey for raynos from 100.101.1.2 port 5 ssh2\nNov 9 sshd[2]: Invalid user admin from 203.0.113.9\nNov 9 sshd[3]: Failed publickey for root from 203.0.113.9\nNov 9 sudo: raynos : COMMAND=/usr/bin/true\n',
    'etc/wildshard/production.env': 'SEAT_SECRET=not-printed\n', 'etc/wildshard/ops.env': 'R2_TOKEN=not-printed\n',
    'home/raynos/.config/systemd/user/openclaw-gateway.service': 'Environment=OPENCLAW_GATEWAY_TOKEN=sk_claw_PLANTEDSECRETVALUE\n',
    'var/lib/ubuntu-advantage/status.json': JSON.stringify({ services: [{ name: 'esm-apps', status: 'disabled' }, { name: 'esm-infra', status: 'enabled' }, { name: 'livepatch', status: 'disabled' }] }),
    ...more,
  };
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); }
  return { root, bin };
}
function tree(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).map(entry => { const path = join(entry.parentPath, entry.name), at = statSync(path); return `${path} ${String(at.size)} ${String(at.mtimeMs)} ${String(at.mode)}`; }).sort();
}
function check(commands: Readonly<Record<string, string>>, env: Readonly<Record<string, string>> = {}, args: readonly string[] = ['--check'], files: Readonly<Record<string, string>> = {}) {
  const { root, bin } = box(commands, files), before = tree(root);
  const run = spawnSync(join(bin, 'bash'), [HARDEN, ...args], { encoding: 'utf8', env: { PATH: bin, HARDEN_ROOTFS: root, ...env } });
  expect(tree(root)).toEqual(before);
  const rows = run.stdout.split('\n').filter(row => row !== '');
  return { status: run.status, out: run.stdout + run.stderr, rows, failed: (row: string) => rows.filter(text => text.startsWith('fail ') && text.slice(8).startsWith(`${row} `)) };
}

test('on the audited box, every row from VH2 to VH15 but VH8 fails, and nothing on the box changes', () => {
  const run = check(TODAY);
  expect(run.status).toBe(1);
  for (const row of ['VH2', 'VH3', 'VH4', 'VH5', 'VH7', 'VH9', 'VH10', 'VH11', 'VH12', 'VH13', 'VH14', 'VH15']) expect(run.failed(row), row).not.toEqual([]);
  expect(run.failed('VH8')).toEqual([]);
  for (const want of ["sudo group is 'raynos,matt'", 'a docker group exists', "login users: 'clawdbot matt raynos'", 'the third-party ollama snap', 'something listens on 11434',
    "sshd x11forwarding is 'yes'; want no", "sshd maxauthtries is '6'; want 3", "ufw rules beyond tailscale0, 41641/udp and Cloudflare's 443: 22/tcp ALLOW IN Anywhere",
    'running kernel 6.8.0-139-generic; 6.8.0-147-generic is installed', 'unattended-upgrades never reboots', 'never updates: nodesource tailscale caddy cloudflare',
    'info    VH5   pro esm-apps is disabled (D6: Ubuntu Pro skipped)', 'no caddy jail: behind Cloudflare', 'wildshard-server@production.service exposure 8.3', 'Caddy is not installed',
    'production sets no TRUST_PROXY', 'no PostgreSQL server', 'production.env is 640 root:wildshard; want 640 root:wildshard-production',
    'no installed dump.sh', 'journald keeps no log', 'ops.env names no SENTRY_CRON_DSN (J252)', 'sysctl drift: net.ipv4.ip_forward=1', 'fs.suid_dumpable=2'])
    expect(run.out, want).toContain(want);
  expect(run.out).toContain('1 files under /home or /etc hold an OpenClaw token (sk_claw); names withheld');
  expect(run.out).toContain('sudoers.d/90-cloud-init-users: 1 rules for matt, 1 NOPASSWD');
  expect(run.out).not.toContain('NOPASSWD:ALL');
  expect(run.out).toContain('auth.log: 1 accepted SSH logins (raynos@100.101.1.2 x1), 2 failed or invalid, 0 as root, 1 sudo commands');
  expect(run.out).toContain('unknown VH4   Hetzner Cloud Firewall: no hcloud here');
  for (const secret of ['PLANTEDSECRETVALUE', 'not-printed']) expect(run.out).not.toContain(secret);
});

test('without root, what root alone reads is unknown, never a pass', () => {
  const run = check(TODAY, { HARDEN_TEST_UID: '1000' });
  expect(run.status).toBe(1);
  for (const want of ['unknown VH1   sudoers.d and auth.log: needs sudo', 'unknown VH2   OpenClaw token search: needs sudo', 'unknown VH3   sshd -T: needs sudo',
    'unknown VH4   ufw rules: needs sudo', 'unknown VH6   fail2ban-client status: needs sudo', 'unknown VH11  PostgreSQL roles: needs sudo', 'unknown VH12  /etc/wildshard modes: needs sudo'])
    expect(run.out).toContain(want);
  for (const row of ['VH3', 'VH4', 'VH6', 'VH12']) expect(run.rows.filter(text => text.startsWith('ok ') && text.slice(8).startsWith(`${row} `)), row).toEqual([]);
});

/** A box with VH2 to VH4, VH6 to VH8, VH10 and VH15 done. */
const HARDENED: Readonly<Record<string, string>> = { ...TODAY,
    getent: `case "$1 \${2:-}" in 'group sudo') echo 'sudo:x:27:raynos' ;; 'group docker') exit 2 ;; 'passwd ') echo 'raynos:x:1000:1000::/home/raynos:/bin/bash' ;; esac`,
    snap: 'exit 1', ss: `printf 'LISTEN 0 4096 100.64.0.9:22 0.0.0.0:*\\nLISTEN 0 511 127.0.0.1:8790 0.0.0.0:*\\n'`,
    sshd: `printf 'passwordauthentication no\\npermitrootlogin no\\nkbdinteractiveauthentication no\\nx11forwarding no\\nmaxauthtries 3\\nallowusers raynos\\n'`,
    ufw: `printf 'Status: active\\nDefault: deny (incoming), allow (outgoing)\\n\\nTo   Action   From\\n443/tcp                    ALLOW IN    173.245.48.0/20\\n41641/udp                  ALLOW IN    Anywhere\\nAnywhere on tailscale0     ALLOW IN    Anywhere\\n'`,
    'fail2ban-client': `printf 'Status\\n\`- Jail list:\\tcaddy, sshd\\n'`,
    systemctl: `case "$1" in cat) exit 0 ;; show) echo 'Environment=TRUST_PROXY=caddy "ALLOWED_ORIGINS=https://play.wildshard.io"' ;; esac`,
    'systemd-analyze': `echo "→ Overall exposure level for $3: 2.9 OK"`,
    sysctl: `case "$2" in net.ipv4.conf.all.log_martians|net.ipv4.tcp_syncookies|kernel.dmesg_restrict|kernel.kptr_restrict|kernel.yama.ptrace_scope) echo 1 ;; kernel.unprivileged_bpf_disabled) echo 2 ;; *) echo 0 ;; esac`,
    nft: `printf 'table inet wildshard {\\n chain input {\\n  tcp dport 443 ct state new update @rate443 { ip saddr limit rate over 600/minute burst 200 packets } drop\\n  tcp dport 443 ct state new add @edges443 { ip saddr ct count over 2000 } reject with tcp reset\\n }\\n}\\n'`,
    hostname: `if [ "$1" = -I ]; then echo '46.224.236.227 100.64.0.9'; else echo box; fi`,
    hcloud: `case "$1 $2" in 'server list') echo '[{"id":1,"public_net":{"ipv4":{"ip":"46.224.236.227"}}},{"id":2,"public_net":{"ipv4":{"ip":"198.51.100.2"}}}]' ;;
  'firewall list') if [ -n "\${HARDEN_TEST_FIREWALLS:-}" ]; then echo "$HARDEN_TEST_FIREWALLS"; else echo '[{"name":"edge","applied_to":[{"server":{"id":1}}],"rules":[{"direction":"in","protocol":"tcp","port":"443"},{"direction":"in","protocol":"udp","port":"41641"},{"direction":"out","protocol":"tcp","port":"any"}]}]'; fi ;; *) exit 1 ;; esac`,
};

test('a hardened box reads clean for the rows it can see', () => {
  const run = check(HARDENED);
  // The made-up box keeps its planted OpenClaw token, so VH2's search still finds it.
  expect(run.failed('VH2')).toEqual(['fail    VH2   1 files under /home or /etc hold an OpenClaw token (sk_claw); names withheld']);
  for (const row of ['VH3', 'VH4', 'VH6', 'VH7', 'VH8', 'VH10']) expect(run.failed(row), row).toEqual([]);
  expect(run.out).toContain('ok      VH10  production TRUST_PROXY=caddy');
  expect(run.out).toContain("ok      VH10  production ALLOWED_ORIGINS is the game's own hosts");
  expect(run.out).toContain('ok      VH4   Hetzner Cloud Firewall edge lets in TCP 443 and UDP 41641 only');
  expect(run.out).toContain('ok      VH9   nftables floors 443 at 2000 concurrent per Cloudflare edge');
  expect(run.out).toContain('ok      VH9   nftables floors 443 at 600 new connections a minute per Cloudflare edge');
  expect(run.out).toContain('ok      VH4   ufw allows only tailscale0, 41641/udp and 443 from Cloudflare');
  expect(run.out).toContain('info    VH4   443 is open in ufw to 1 Cloudflare ranges');
  expect(run.out).toContain('ok      VH15  sysctl matches');
});

test('without --check it applies, which needs root; a stray argument stops', () => {
  const apply = check(TODAY, { HARDEN_TEST_UID: '1000' }, []);
  expect(apply.status).toBe(1); expect(apply.out).toContain('Run with sudo');
  const stray = check(TODAY, {}, ['--apply']);
  expect(stray.status).toBe(1); expect(stray.out).toContain('Expected no arguments, --check, --open-443 or --close-443');
});

test('443 in ufw from anywhere but Cloudflare is drift', () => {
  const run = check({ ...HARDENED, ufw: `printf 'Status: active\\nDefault: deny (incoming), allow (outgoing)\\n\\nTo   Action   From\\n443/tcp                    ALLOW IN    Anywhere\\nAnywhere on tailscale0     ALLOW IN    Anywhere\\n'` });
  expect(run.out).toContain("fail    VH4   ufw rules beyond tailscale0, 41641/udp and Cloudflare's 443: 443/tcp ALLOW IN Anywhere");
});

test('an env-file override is what counts, and a spoofable or open setting fails', () => {
  const run = check({ ...HARDENED, systemctl: `case "$1" in cat) [ "$2" != cloudflared.service ] ;; show) echo 'Environment=TRUST_PROXY=caddy "ALLOWED_ORIGINS=https://play.wildshard.io"' ;; esac` },
    {}, ['--check'], { 'etc/wildshard/production.env': 'SEAT_SECRET=not-printed\nTRUST_PROXY=cloudflare\nALLOWED_ORIGINS=*\n', 'etc/wildshard/staging.env': 'ALLOWED_ORIGINS=https://play.wildshard.io,https://evil.example\n' });
  expect(run.out).toContain('fail    VH10  production TRUST_PROXY=cloudflare; want caddy behind Funnel or Caddy');
  expect(run.out).toContain('fail    VH10  production ALLOWED_ORIGINS lets any page in');
  expect(run.out).toContain('ok      VH10  staging TRUST_PROXY=caddy');
  expect(run.out).toContain("fail    VH10  staging ALLOWED_ORIGINS has a page outside the game's hosts");
  expect(run.out).not.toContain('not-printed');
});

test("a Hetzner firewall on another server, or one that lets in more, is not this box's", () => {
  const elsewhere = check(HARDENED, { HARDEN_TEST_FIREWALLS: '[{"name":"other","applied_to":[{"server":{"id":2}}],"rules":[]}]' });
  expect(elsewhere.out).toContain('fail    VH4   no Hetzner Cloud Firewall is applied to this server');
  const wide = check(HARDENED, { HARDEN_TEST_FIREWALLS: '[{"name":"edge","applied_to":[{"server":{"id":1}}],"rules":[{"direction":"in","protocol":"tcp","port":"22"},{"direction":"in","protocol":"tcp","port":"443"}]}]' });
  expect(wide.out).toContain('fail    VH4   Hetzner Cloud Firewall edge lets in tcp/22 tcp/443; want tcp/443 udp/41641');
});
