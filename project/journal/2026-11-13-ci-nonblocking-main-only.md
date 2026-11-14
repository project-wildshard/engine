# Boundaries and quarantine run on main, not on plan branches

HOW-WE-BUILD CIQ1 (opus-ciqueue). Every land runs `ci` twice: once on
`plan/<slug>` while land waits, once on main. Two of the eight jobs,
`boundaries` (the report-only cook-to-play) and `quarantine` (the
quarantined proofs), are continue-on-error and never decide a land,
yet they ran on every plan push, about 240 runner-minutes a day.

They now skip any `plan/**` run (`if: !startsWith(github.ref,
'refs/heads/plan/')`). The catch was main's exact reuse: on a main
push of a SHA its plan run already proved, each of these jobs reused
that run and skipped its work. With the plan run no longer holding
them, every landed SHA would have lost both. So these two jobs drop
their reuse step and run on every main push; a docs-only push still
skips through `ci-selection`. Each landed SHA keeps one boundaries and
one quarantine run, now on main. The blocking `tests` shares keep
their reuse and run on plan branches as before, and the reuse proof
(`ci-proof-jobs.mjs`) only reads those.

`test/land.test.ts` pins both halves: the two jobs carry the ref skip
and no reuse step, and `tests` keeps its reuse and no `if:`. The
older "every job gates on reuse" case now holds for `tests` only.
actionlint is clean.
