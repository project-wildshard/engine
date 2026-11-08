# Retain the eighth real released checkpoint

Written by: Codex. 2026-11-08. EG-31.

The previously captured v0.1.1 Nalati checkpoint is authentic and restores
in place, but its 9,565,519 compressed bytes exceed the git blob cap. Keep
the body whole in the existing public pins release under its sha256 name:
aa96f2980ef0cc80db1b0cfbf02235649546a5b486f5f71c1f34c9008573edbe.save.br.
It was uploaded without replacing any asset. Readable provenance remains
in test/pins/saves, including the original release/head/epoch and position.

Normal pin installation prepares remote save fixtures before tests, with
size and sha256 verification and atomic cache publication. A separate
install-saves command also supports a cold fixture-only preparation. The
test reads the prepared immutable pin; no network time enters its clock.

All eight actual released saves resume at their saved tick/place and keep
walking; the complete file passes in nine seconds on the Mac. A fresh
empty cache downloads the public mirror body and verifies the same hash.
No body pruning, split git blobs, fabricated old state or new credential.
