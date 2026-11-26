# The moved-path guard counts a climbed root

> Written by: Claude (opus-root118), 2026-11-26, meta QA 11-25 row 118.

repo-kit 3c56bb4's script-paths guard, stamped: a root climbed from a
script's own folder (`resolve(import.meta.dirname, '..')`,
`new URL('..', import.meta.url)`, `$(dirname "$0")/..`, a `cd` there,
`Path(__file__).parent.parent`) is counted against the file's real
depth. Here, staging-deploy climbed `scripts/..`, which the lean move made
`src/`, so v0.1.94's go-live wrote scratch into an unignored `src/tmp/`
and could not upload (fixed in 1542b3612). The guard flags that exact
pre-fix file and finds nothing else; it now refuses a new one.
