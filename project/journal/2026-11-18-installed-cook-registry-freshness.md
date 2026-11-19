# Installed cook registry freshness

> Written by Codex, 2026-11-18.

The full local gate for Template revision 10 stopped at the installed
ASTC cook. npm returned `ETARGET` for shard-format `0.41.1` while using
an older cached packument. A fresh query resolved that exact version on
the public registry.

The install fixture now revalidates registry metadata inside the same
request and command timeouts. It still installs the real engine tarball,
reproduces the broken worker hook and cooks the ASTC phone fixture with
the fixed hook. The separate delayed-request fixture keeps testing retry.
