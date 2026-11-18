# Resume a main dispatch from a proved history scan

In run 44233634711, tests (1) hit its 25-minute timeout in the
incoming-history scan. A main dispatch has no before SHA and
previously scanned the whole repository.

A main dispatch can use the newest ancestor with a green main
push, a completed code proof and a successful incoming-history
scan in tests (1). The existing hook scans all commits after
that ancestor. With missing or incomplete proof it still scans
the full history. Push and pull-request ranges use their
existing inputs.

The cold CI proof exercises the actual workflow command and
hook. It checks the exact suffix scan, fallback when the earlier
scan was skipped or the Actions API is unavailable, and the
unchanged push range.
