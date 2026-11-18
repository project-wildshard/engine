# The native footprint guard runs in its own workflow

Main run 44392712273 on 8cd83a0f had 14 of 14 jobs green. Its
memory-footprint-guard job then waited more than 45 minutes with no
xcode-27 runner assigned, so main had no verdict and every later push
queued behind it. Job-level `continue-on-error` does not help a job
that never starts. The Coordinator asked for the job to move out of
ci.yml.

The job now lives in `.github/workflows/memory-footprint.yml`, with
these properties:

- It runs on `workflow_run` after ci completes for main and release
  branches, following ci-reports' pattern. It has to come after ci:
  it measures ci's own `memory-pinned-client` artifact, which
  memory-client-build archives with a one-day retention.
- A run with no artifact, from a docs-only push or a failed build,
  ends with a notice.
- An empty armed policy measures nothing, as before.
- The steps and the 90-minute timeout are unchanged.
- It has its own concurrency group per branch, with
  `cancel-in-progress: false`. One sweep runs; a newer source replaces
  the queued one and never cancels a started sweep.
- Recording is a `workflow_dispatch` with the ci run id and
  `memory_record`. A workflow_run cannot see ci's dispatch inputs.

main-watch judges ci runs only, so the footprint result no longer
decides main's verdict (J424). This supersedes the main-blocking half of
1f597729: a completed comparison failure now shows as a red
memory-footprint run, not a red main. Whoever owns the armed zone still
fixes it.

memory-armed.test.ts and land.test.ts now read the job from the new
file. They check that ci.yml has no such job, that the new workflow
follows ci, and that it downloads the source run's client.
