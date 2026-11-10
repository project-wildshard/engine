# Keep explicitly requested native diagnostics

Q140's failed queue view was deleted after the hook printed a profile path.
The path was diagnostic text, not a retention protocol. Nobody was identified
as deleting that fixture separately. The old real-queue CLI proof reproduces
this: its hook creates the marker, fails, and snapshot cleanup leaves no
retained directory. The new driver keeps the marker while the same hook fails
and the unpublished snapshot is deleted.

A caller may exclusively write a UUID JSON file under
`tmp/queue-retain-requests/`. The three exact fields are `schema`, `kind` and
`profile`; schema is `wildshard.native-retain/1`. Kind `native-writer-drain`
selects `tmp/native-writer-drain-` plus six alphanumeric characters. Kind
`native-escape` selects `tmp/escape-control-` plus the same suffix shape.
Nothing derives authority from stderr. The caller still rethrows its original
cleanup error. The shared native drain API and its deadlines do not change.

Only a failure of the actual hook invokes export, including failed batch candidates
before bisection. Green hooks ignore requests, even when publication fails later. Python traverses source and
output by directory descriptors without following links, and copies only
owner-held regular single-link files. It skips Chrome Singleton links, FIFOs
and other special entries. Source mutation during a copy refuses that file, including ctime changes when a same-size writer restores mtime.
Destination request directories are exclusive, so later attempts cannot
replace earlier evidence. All copied directories are private and files are
mode 0600. No upload, VCS inclusion or global cleanup is added.

Exports live under the queue's `retained/<job>/<request-uuid>/`. A separate
`retention-<uuid>.json` binds the checked SHA, original relative profile,
content hash and copied/omitted counts. This is a requested diagnostic subset,
not a claim that a particular case caused the candidate's failure or that a
Chrome profile is complete or replayable. Limits are 16 cumulative requests, 4096 entries
and 64 MiB per job, 256 MiB across the retained namespace, plus bounded
inspection and a four-second exporter deadline. The parent allows six seconds.
A refused or interrupted export is named in the worker log and never replaces
the original failed result. Prior evidence remains; a full namespace refuses
new exports instead of deleting old diagnostics.

The outer-edge CLI proofs run outside the suite and hooks. The normal failed
hook survived cleanup in 1.5 to 2.4 seconds; the green control exported nothing
in 2.2 seconds. Two queued red requests exercised combined candidate cleanup
and bisection in 6.55 seconds. Filesystem controls reject path escapes,
malformed kind values, source/destination symlinks, hard links and FIFOs, retain
two exact regular files, and preserve earlier evidence on a duplicate request.
Quota controls stop at 16 requests and 4096 entries and refuse the full
namespace. A concurrent timestamp writer changes a real 63 MiB source during
copy; that partial payload is removed. A manifest-directory symlink makes the
exporter fail while the actual failed hook and unpublished remote stay red.
No Chromium or live-server session was launched for these proofs.

The J206 one-shot review found two must-fixes. An actual green hook followed
by a real remote rejection initially exported profiles; it now exports none
and remains unpublished. A second export after 16 previous retained requests
initially copied a seventeenth marker; it now refuses that request. The three
review should-fixes are also closed: ctime is checked (the actual 63 MiB
same-size/mtime-restored writer is old-red/new-green), the partial destination
is asserted absent, and the batch proof requires exactly three exports bound
to their observed combined/singleton hook SHAs and job IDs. Content hashes use
sorted relative paths. No gate, ownership or deadline cap changes.

Caller integration is reproducible with
`node scripts/push-queue-retain-proof.mjs caller`, outside hooks. It invokes
the public actual caller's request-only control from a real Git hook's tiny
private snapshot, without launching a browser. The original EACCES leaves the
hook red and remote unchanged. After snapshot deletion, the exact remaining
`locked/marker` bytes survive with native-escape manifest and checked Git SHA.
The retained payload is 13 bytes, SHA256
`3ec2e08612073cc5950118b6d209120bdc7ded3c661b8d1fef4da273e92baeba`.
The actual caller module matches public b16f67b. This proves remaining-file
retention, not restoration of files already removed by the failed cleanup,
a complete replayable Chrome profile or a hosted verdict. The 1.87-second
control preserves all existing generic/batch safety controls.
