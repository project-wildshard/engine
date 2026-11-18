# The footprint job is advisory while nothing it reads is armed (J424)

Run 44358473370 on 3701945a went red on memory-footprint-guard. That
commit already carried this morning's J424 change, which makes the guard
report-only. The guard never ran, though. GitHub's annotation reads "The
job was not acquired by Runner of type hosted even after multiple
attempts" (macOS arm64 capacity), and the job was cancelled with no
steps after waiting 17 minutes. Report-only logic inside a script can't
help a job that never starts.

So the job is now non-blocking at both ends:

- In ci.yml, `continue-on-error: true` keeps the workflow from failing
  on it.
- main-watch lists it as advisory, the same way it treats the macOS
  street job. ADVISORY_VERSION goes to 4, so cached verdicts are judged
  again.

J424 still holds: a zone that is armed must block.
`memory-ratchet.test.ts` reads the footprint and WebKit baselines, and
the day the Template anchor or Nine's zone says `"armed": true`, it
fails until both lines come out.
