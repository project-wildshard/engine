# VPS setup and private backups

Owner: Jake. These are operator instructions; no bucket, token, service
or secret has been created by the E7 source port.

Run `scripts/vps/setup.sh --check` before the privileged setup in the VPS
sitting. `sudo bash scripts/vps/setup.sh` creates protected blank env
files and units; it preserves an existing filled-in env file. The server
still needs its signed release, pack origin and local PostgreSQL setup.

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
