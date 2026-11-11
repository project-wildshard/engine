# VPS setup and private backups

Owner: Jake. Phase 1 ran on the existing VPS at `d074282`. Phase 2 was
reviewed, published in `fba1f8f` with exact CI/Ring 1 green, and applied
by Jake on 2026-11-09. Its staged setup bytes matched that source.
Agents made no sudo or VPS service changes.

Phase 2 requires Phase 1's existing PostgreSQL 16, user and packages. It
does not install packages, alter PostgreSQL, restart shared services or
touch Docker, OpenClaw or other users. Writes stay in `/etc/wildshard`,
`/var/lib/wildshard` and `wildshard-*` units. Helpers move into our own
`/etc/wildshard/lib`; backup settings remain byte-identical.
The server unit explicitly sets `PLAYTEST_DIR=/var/lib/wildshard/logs`.
With `PLAYTEST=1`, E7.8a writes `playtest-<date>.jsonl` there, inside its
existing writable sandbox; it does not use `/var/log/wildshard`.

Run `bash scripts/vps/setup.sh --check` first. It inspects listeners,
private Serve, both Funnel ports, the public pin and both env files even
after a failed probe. An unprivileged check says `cannot verify` for
protected env files and PostgreSQL, rather than inventing missing state.
Unknown is not a green privileged verification.

After review, the lane stages the pushed `scripts/vps` source under
`~/wildshard-e7/phase2`, runs that unprivileged check, then gives Jake
this single command, requiring only his sudo password:

```sh
ssh -t wildshard 'sudo bash ~/wildshard-e7/phase2/scripts/vps/setup.sh'
```

The staged `release-public-key.hex` must be a regular, raynos-owned file
without group/world write permission, matching the public key embedded
in setup.sh and GitHub's `E7_RELEASE_PUBLIC_KEY`. An explicit
`RELEASE_PUBLIC_KEY` environment value must match it too. Existing filled
settings survive. A different filled trust root refuses activation.
Only exactly blank rows are filled, atomically as `640 root:wildshard`:

- `PACK_ORIGIN=https://packs.wildshard.io`.
- `RELEASE_URL` is that origin's `releases/production.json` or
  `releases/staging.json`.
- `RELEASE_PUBLIC_KEY` is the verified public pin.

No seat secret or credential is printed or regenerated in an existing
file. No manual env editing is needed for these three settings.

Funnel maps production HTTPS 443 to loopback 8790, and staging HTTPS
8443 to loopback 8791. The script prints the stable `wss://` addresses
from the node's tailnet DNS name. Private HTTP Serve on port 8790 stays
tailnet-only. Before every route change, all paths on either public
host:port must be absent or exactly ours; foreign TCP, foreground or
AllowFunnel configuration refuses. A completed rerun is accepted.
No Serve/Funnel reset, off command or Tailscale identity change occurs.
The old quick-tunnel unit is left untouched and reported if still active.

## Rebuild from nothing (MMO-PLAN MP0.1)

`scripts/vps/rebuild.sh` takes a fresh Ubuntu 24.04 image to a serving
host: Phase 1 (Node 24 from NodeSource, apt PostgreSQL 16, rclone,
Tailscale, Caddy installed and off; the `raynos`, `wildshard` and
`wildshard-cook` users; PostgreSQL's local-socket settings, role and both
saves databases; a blank `ops.env`; the staged release public key), then
`harden.sh` (VPS-HARDENING; today only its read-only `--check`, VH1, does
anything), then `setup.sh` (Phase 2),
then the cook worker. Every step checks first and does only what is
missing, so a rerun is safe and a finished box reruns with no change.

**Hard stop.** It refuses, in both modes, a host that still holds the old
box's data (`/home/clawdbot`, `/home/matt`, any `.openclaw`, the Ollama
snap, Coolify's volume). It is for the box after OPENCLAW-EXTRACT's OX10
and the Hetzner rebuild (VPS-HARDENING VH2), never for today's VPS.

On the fresh box, as root, from the release tag being deployed:

```sh
curl -fsSL https://github.com/project-wildshard/engine/archive/refs/tags/<tag>.tar.gz | tar -xz -C /root
bash /root/engine-<tag without v>/scripts/vps/rebuild.sh --check
bash /root/engine-<tag without v>/scripts/vps/rebuild.sh
```

Exit 0 is done. Exit 2 means it did everything it could and waits for
one of Jake's inputs; it names each one, and a rerun picks up from there:

- `sudo tailscale up --ssh`: Phase 2 needs the node's tailnet name.
- `/etc/wildshard/cook.env`: the engine tag and build the worker cooks
  for, the notify token api-server sends, and the four R2 packs rows
  (or `COOK_STORE_DIR` on a scratch box). Until then the cook worker
  stays off; the game servers do not need it.
- `passwd raynos`, printed as `next`, for sudo and the console.

Caddy's package would serve a page on port 80, so it is installed with
its start refused, its default file is replaced by a comment, and it is
disabled. VH9 writes the real file, which reruns leave alone; port 443
opens by Jake's hand after VH16 (J179).

The cook worker runs from `/opt/wildshard/engine` at `COOK_ENGINE_REF`
(CI's sparse set, `pnpm install --frozen-lockfile --ignore-scripts` once
per commit, so no package script runs as root) as
`wildshard-cook`, on `127.0.0.1:8792`, with CPUs 13-15. Each cook job
runs in a user and network namespace of its own. Ubuntu 24.04 refuses
those to unconfined programs (`kernel.apparmor_restrict_unprivileged_userns=1`,
true on the VPS), so the worker gets its own copy of `unshare` in
`/usr/local/lib/wildshard-cook` and one AppArmor profile allowing that
copy only. The unit checks the wrap once before it starts.

**Proof without the VPS.** `bash scripts/vps-rebuild-proof.sh` runs the
whole sequence in a throwaway container that boots systemd (Docker on
the Mac, its own arm64; Rosetta's amd64 cannot run systemd's services): `--check`, a run that waits for Tailscale, a stub
`tailscale up`, a run through Phase 2 that waits for `cook.env`, a run
that starts the cook worker against a local catalogue of one pinned
shardfile, and a last run that must change nothing. It passes only when
both loopback ports answer from real servers that pulled the signed
releases, the cook worker has written the shard's index, and nothing
listens on 80 or 443. The stubbed parts are the tailnet (Jake's) and
api-server; `api.wildshard.io` resolves to nothing inside the box.

## Hardening (VPS-HARDENING VH3 to VH15, MMO-SERVER-PLAN MS3.1)

`sudo bash scripts/vps/harden.sh` applies every row; `rebuild.sh` runs it
before Phase 2, and a rerun changes nothing. What it does:

- **VH3, VH4 (D1):** waits until the box is on the tailnet, then ufw
  denies in and allows only `tailscale0` and UDP 41641; sshd takes keys
  only, `raynos` only, no root; Tailscale SSH is turned off, so tailnet
  SSH reaches that sshd. A dead-man (`wildshard-harden-deadman.timer`)
  undoes ufw, Tailscale SSH and the sshd file 10 minutes later unless
  the operator stops it from a new SSH session.
- **MS3.3:** `/etc/sudoers.d/20-wildshard-agents` lets `raynos` run, with
  no password, only `systemctl start|stop|restart|--no-pager status` on
  the two servers, the two pull units and the cook, `restart` and
  `status` of Caddy, `/usr/local/sbin/wildshard-harden --check` and
  `/usr/local/sbin/wildshard-restore-check` (root-owned copies). The
  journal comes from the `systemd-journal` group, and `wildshard-lynis`
  runs the gate's audit. Anything else (a rerun of `rebuild.sh`,
  `setup.sh` or `harden.sh` itself) is Jake's, with his own `raynos`
  password, which is also the Hetzner console break-glass:
  `ssh -t wildshard 'sudo bash ~/vps-build/scripts/vps/rebuild.sh'`.
- **VH5:** unattended-upgrades for NodeSource, Tailscale, Caddy and
  Cloudflare, rebooting at 04:30 UTC. No Ubuntu Pro (D6).
- **VH6, VH14 (J252):** fail2ban's `sshd` jail. Every SSH or console
  login, `sudo` session and ban sends one Sentry event (logger
  `wildshard-auth`, DSN from `ops.env`'s `SENTRY_CRON_DSN`) for the
  agents' read. No `caddy` jail: behind Cloudflare a ban by address
  would ban an edge, and the server limits each player by
  `CF-Connecting-IP`.
- **VH7:** sandbox drop-ins for both servers (production `MemoryMax=18G`,
  staging `6G`), the cook (`4G`, keeps user and network namespaces) and
  Caddy. They take effect at each unit's next restart.
- **VH9 (J264):** `harden-caddy.sh` writes Caddy for
  `rooms.wildshard.io` (8790, plus `/up`, a bare 200 while production's
  `/health` is) and `rooms-staging.wildshard.io` (8791): a Cloudflare
  Origin CA certificate at `/etc/caddy/origin/rooms-origin.{pem,key}`,
  Authenticated Origin Pulls (client certificate required, CA pinned),
  `CF-Connecting-IP` believed only from Cloudflare's ranges and passed on
  as the single `X-Forwarded-For` hop (`TRUST_PROXY=caddy` reads it),
  Origin allowlist, `admin off`, HTTP/1.1 and 2 only. nftables floors per
  Cloudflare edge sit beside ufw. Caddy starts once the certificate is
  there. Port 443 opens only with `sudo bash harden.sh --open-443`
  (Cloudflare's ranges, nothing else) after the pre-open gate, and
  `--close-443` shuts it again.
- **VH11, VH12:** `rebuild.sh` gives each channel its own OS user
  (`wildshard-<channel>`) and database role (`wildshard_<channel>`),
  peer-mapped over the socket, each owning one database with `CONNECT`
  revoked from `PUBLIC`; `setup.sh` runs each channel's units as its user
  with `PGUSER`, its own folder, pack cache and logs, and env files
  `640 root:wildshard-<channel>`.
- **VH13:** with `AGE_RECIPIENT` in `ops.env`, `dump.sh` encrypts each
  dump to that age key (`.dump.age`) before it touches disk. The private
  key stays on the Mac (`~/.config/wildshard/backup-age-key.txt`); a
  restore check copies it over for the run only:
  `AGE_IDENTITY=<file> restore-check.sh <dump>`.

## Hardening report (VPS-HARDENING VH1)

`scripts/vps/harden.sh --check` reads what an unprivileged audit cannot
(ufw rules, `sudoers.d`, `sshd -T`, fail2ban, auth.log, PostgreSQL roles,
`/etc/wildshard` modes, sysctl, the Hetzner firewall when `hcloud` is set
up) and prints one `ok`, `fail`, `unknown` or `info` line per finding,
tagged with its VPS-HARDENING row. It changes nothing. Exit 0 is clean, 1
is any failure, 2 is something unreadable. Without root, root-only reads
say `unknown`. Jake runs it on the box, from an engine checkout:

    scp scripts/vps/harden.sh wildshard:harden.sh && ssh -t wildshard sudo bash harden.sh --check

`bash scripts/vps-harden-proof.sh` proves it in a throwaway container
dressed as the audited box; `test/vps-harden.test.ts` pins its parsing.

**Proxy trust (VH10).** The server reads a forwarded address only from a
loopback peer, and only the header `TRUST_PROXY` names: `caddy` (the
default) takes the last `X-Forwarded-For` hop, which Tailscale Funnel and
Caddy both write themselves; `cloudflare` takes `CF-Connecting-IP`; `none`
reads no header. A browser's `Origin` must be in `ALLOWED_ORIGINS` (the
game's own hosts by default; `*` allows any) or the upgrade gets 403.
`setup.sh` sets both in `wildshard-server@.service`; an env-file line
overrides them.

## J205: live agent traffic is staging only

Production serves humans only. Every live agent proof, bot and soak uses
`wss://wildshard.tailb41b20.ts.net:8443`, the staging channel and
`saves_staging`. Build its separate client origin for the exact signed
staging SHA and `releases/staging.json`; never repurpose the human
production page or join the production socket from a proof.

The staging unit already sets `RELEASE_CHANNEL=staging` and reads
`/etc/wildshard/staging.env`. Without a database override, the verified
release channel selects `saves_staging`. A live proof must not override
that with a production database. Local isolated rigs may use memory or
a disposable test database. No production wipe or sudo SQL cleanup is
part of setup or proof preparation. Codex-port owns the page/proof guard;
codex-j189 owns the runbook and VPS channel setup.

## Bots (MMO-PLAN MP0.4)

`node scripts/mmo-bots.mjs replica|staging` runs real-socket bots from
this Mac (J202). Each bot is a phone's network end (`RoomBot`: `hello`,
`resume`, `ready`, commands at 60 Hz) walking `headlessJourney`'s route
cursor in rings around where it stands, steered by the feet the server
sends back. Both modes read the signed staging release, check it
against setup.sh's pinned key, and build the bots from that release's
own commit, so build and wire match the server's.

- `replica` (default 32 bots, 120 s) runs that release's exact server
  bundle on loopback with production's shape: 4 workers, 32 seats,
  Driftwood, packs read from R2, memory saves, nothing sent off the Mac.
  The door seats 4 sockets and 10 connects a minute per address, and
  behind loopback it reads the proxy's `X-Forwarded-For`, so each replica
  bot says its own address from 198.18.0.0/15 (RFC 2544's benchmarking
  range), as 32 phones would have. Its worker readings (tick p95, drops,
  RSS) join the report.
- `staging` (default 2 bots, 60 s) joins the staging socket only after
  `/health` shows the release's build and enough free seats: it leaves
  4 of staging's 16 for people. Through Funnel every bot is this Mac's
  one address and no header says otherwise, so at most 4 join. Staging's
  2 workers are its own setting.

The bots refuse any socket but loopback and staging, and leave with the
leave flag so no held body keeps a seat. The report is
`tmp/mmo-bots/<stamp>/report.json`: seated, steady, metres walked,
others seen, bytes down, RTT, and the server's windows on a replica.

## Sentry (SENTRY-TRIAGE S8)

A channel's server sends its errors to Sentry's `wildshard-server`
project when its env file has a `SENTRY_DSN` row with the project's DSN
(Sentry, project settings, Client Keys). A blank or missing row sends
nothing. Events carry release `wildshard@<version>`, the build as
`dist` and the channel as environment, and no host, player or request.
After adding the row, restart the unit, then check it as the unit runs:

```sh
sudo systemctl restart wildshard-server@staging
sudo -u wildshard sh -c 'set -a; . /etc/wildshard/staging.env; RELEASE_CHANNEL=staging node /var/lib/wildshard/staging/current/main.mjs --sentry-test'
```

`--sentry-test` sends one deliberate event and exits 0 when Sentry took
it. It refuses every channel but staging.

Both public loopback targets have an owned health stub while waiting for
their first signed release, including staging. The owned pull timers
verify and download before starting the game units, whose conflicts
remove only our health stubs. Missing channel publication fails the
preparatory unit rather than repeatedly starting the game. An active
game skips this first-release pull. Check the actual release and book
on the configured pack origin before the sitting; the setup candidate
does not publish either of them.

The CLI references are [Tailscale Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel),
[Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) and
[systemd OnSuccess](https://www.freedesktop.org/software/systemd/man/255/systemd.unit.html#OnSuccess=).

## J199: create the private backup destination

Jake uses his Cloudflare account owner login for these steps. In R2
Object Storage, create `wildshard-backups`. Keep public development
access disabled, attach no public custom domain, and configure no public
Worker route. Dumps contain player identifiers and save documents.

Create an R2 account API token named `wildshard-vps-backups` with
**Object Read & Write**, **Apply to specific buckets only**, selecting
only `wildshard-backups`. Use its S3 access key ID and secret access key;
the management API bearer token is not an S3 credential. This token
lists, writes, restores and expires backup objects. It has no bucket
administration or `wildshard-packs` access. Keep the release producer's
packs credential separate.

Jake opens `sudoedit /etc/wildshard/ops.env` on the VPS, using his VPS
sudo login, and fills these existing settings from the token confirmation
page. No value belongs in git, chat, a command argument or a CI secret:

```dotenv
BACKUP_REMOTE=r2:wildshard-backups
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
RCLONE_CONFIG_R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2_ACCESS_KEY_ID=<BACKUPS_S3_ACCESS_KEY_ID>
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=<BACKUPS_S3_SECRET_ACCESS_KEY>
```

Keep that file `root:root`, mode `600`. `NO_CHECK_BUCKET` is required
because the bucket-scoped object token cannot create/check a bucket.
The blank default keeps dumps only on the VPS; it does not prove offsite
backup. Do not enable a lifecycle rule shorter than the seven-day policy.

`SENTRY_CRON_DSN` (J252) is the `wildshard-server` Sentry project's DSN.
With it set, each dump checks in to the Sentry Crons monitor
`wildshard-dump` on start and on finish (`ok` or `error`), and the
agents' hourly read sees a failed or missed backup. All Sentry
notifications for it are off; blank skips the check-in.

During the VPS sitting Jake runs this in a subshell, so failure preserves
his shell and does not print credentials:

```sh
sudo bash -c 'set -euo pipefail; set -a
. /etc/wildshard/ops.env
set +a
rclone lsf r2:wildshard-backups
systemctl start wildshard-dump.service
systemctl --no-pager --full status wildshard-dump.service
rclone lsf r2:wildshard-backups'
```

The required evidence is a successful nightly dump, an uploaded object, and a
download restored into a separate disposable database with
`scripts/vps/restore-check.sh`; listing alone is not a restore proof.
The operational seven-day expiry remains in `scripts/vps/dump.sh`.

Cloudflare's [bucket creation instructions](https://developers.cloudflare.com/r2/buckets/create-buckets/),
[scoped S3 credentials](https://developers.cloudflare.com/r2/api/tokens/)
and [rclone settings](https://developers.cloudflare.com/r2/examples/rclone/)
are the operator reference. Only Jake creates or installs these secrets.
E7 retains today's network wire; wire v1 is separate work under J197.
