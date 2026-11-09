# VPS setup and private backups

Owner: Jake. Phase 1 ran on the existing VPS at `d074282`. Phase 2 is a
local candidate awaiting Opus re-review and publication; do not stage
it for the sitting until that review passes. No bucket, token or VPS
service has been changed by this candidate.

Phase 2 requires Phase 1's existing PostgreSQL 16, user and packages. It
does not install packages, alter PostgreSQL, restart shared services or
touch Docker, OpenClaw or other users. Writes stay in `/etc/wildshard`,
`/var/lib/wildshard` and `wildshard-*` units. Helpers move into our own
`/etc/wildshard/lib`; backup settings remain byte-identical.

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

- `PACK_ORIGIN=https://wildshard-packs.wildshard.workers.dev`.
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
