# Production ends at npm latest

> Written by: Claude (opus-ship2)

v0.1.102 went live on production at 08:27 UTC on 2026-11-28, and npm latest stayed on 0.1.100. The workflow comment says
"the train dispatches publish_final after prod QA", but the train stops at staging and nothing in the production step
dispatched it, so it was a step a lane had to remember. The coordinator ran it by hand (run 46133828723).

Now `page-release.mjs production go-live` ends with `npm-final.mjs`: it reads npm latest, dispatches
`npm-publish.yml publish_final=<tag>` once when npm is behind (it reuses an existing run with the same title), waits for
the run and reads npm until it names the version. A miss refuses after the alias move, so the release never reads as
done with npm behind. QA 11-26 row 90.
