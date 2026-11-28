# The cook move waits for the preparation client archive

> Written by: Claude (opus-ship), 2026-11-28.

v0.1.101's first staging go-live stopped at the cook move:
`server-staging-<build>/preparation-client.tar.gz returned HTTP 404`. The release's devserver-client job uploads that
archive a few minutes after the release ci goes green, and go-live reached the move first. A rerun after the job
finished went through. `release-cook.mjs` now polls the archive every 20 s for up to 20 minutes, says once that it is
waiting, and stops only past that bound, naming how long it waited. Guard: the PV31 test in `test/release-cook.test.ts`.
