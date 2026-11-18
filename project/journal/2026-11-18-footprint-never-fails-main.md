# The native footprint job never fails main (J424)

Main run 44375696856 on 4026d299 failed memory-footprint-guard. Nalati
is armed in shard-format's memory policy, and its native WebKit Phone
Low reading was 1,043,634,221 B upper playing against the 1,000,000,000
B line. Loading was 1,229,520,942 B, under its 1,500,000,000 B line.
Codex-memgates qualified Nalati r2 at 932,177,300 B playing earlier
today (8aca05fa), so this is about 111 MB higher. It may be a real
regression or hosted variance; one run cannot tell which.

8aca05fa made the job blocking again: it removed the job from
main-watch's advisory list and its test pinned "no continue-on-error".
The Coordinator asked for the opposite: v0.1.45 needs a green main, and
under J424 a memory gate must never stop an unrelated push. So:

- memory-footprint-guard has job-level `continue-on-error: true`, so a
  failure or a runner that hosted macOS never assigns leaves the run's
  conclusion alone. The job still shows red with the armed-zone message.
- main-watch lists it as advisory again (ADVISORY_VERSION 6), so a
  cancelled or timed-out footprint job cannot turn a run red either.
- The Ubuntu memory-ledger-guard still blocks an armed zone over its
  ceilings; memory-armed.test.ts keeps pinning that.

Codex-memgates found the cause at the same time (7e1343bf): EM11 was
fitted on macOS 27, and macOS 15 charged the same Nalati build more to
WebContent, so the job now runs on `xcode-27`. That fix and this one
stack: the job measures on the right OS and still cannot fail main.

The Nalati reading goes to the Coordinator as a finding; whoever owns
Nalati's memory should read the job's artifact before re-arming
anything.
