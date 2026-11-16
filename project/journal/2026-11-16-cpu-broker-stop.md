# "CPU broker exited before its owner" was the stop, not the cause (buddy-engine)

- The ask: the push gate's broker "exited early under moderate load"
  and killed vitest and lint twice at load 9 to 10 on opus-bugbash's
  push of 3d58034d. That push was then forced with SKIP_CHECK=1.
- The broker never exits on its own. In every case, a sibling check had
  already gone RED: check:saves for 3d58034d (90f03b9b fixed the
  saves-lock row it refused), and lint or typecheck errors in all seven
  old push-queue cases I read. `parallelChecks` then stops every other
  task by SIGTERM to each one's process groups. The vitest run's broker
  sits in that group, takes the SIGTERM, and stops cleanly. vitest-tmp
  sees it go and prints "CPU broker exited before its owner" with an
  empty reason: the loudest line, and the last one.
- Load only stretches lint and typecheck to 25 to 50 s, so they fail
  while vitest is mid-run. The empty reason was itself a bug: the loss
  fired on `exit`, before the broker's stderr had drained.
- Ruled out by running Pine and Driftwood headless suites beside a
  broker, on a private root and on the shared ledger at load 4 to 10: a
  test signalling its own process group, and another lane's admission
  reclaiming the broker.
- Fix:
  - `parallelChecks`: a task that ends after another task's failure
    prints `stopped in N s: <task> failed` and carries `stoppedBy`.
    The first failure is the only RED line, which is the line land's
    `prePushCause` already picks.
  - `startCpuBroker`: `expectExit()` marks the owner's own stop. Loss
    and cleanup wait for `close`, and name the exit code or signal and
    all of the broker's stderr. Its stdin ignores EPIPE.
  - The broker says "CPU broker: stopped by SIGTERM" when signalled.
  - vitest-tmp calls `expectExit()` in its SIGTERM and SIGINT handlers.
    That signal reaches Node before the broker's exit does.
- Test `test/push-stop-cause.test.ts`: a failing check:saves beside a
  long vitest makes one RED, a "stopped" vitest line, and land's cause
  check:saves. An owner shaped like vitest-tmp, with a real broker, is
  group-SIGTERMed and exits 0 with no loss message. When only its broker
  is signalled, it reports the loss with the signal.
