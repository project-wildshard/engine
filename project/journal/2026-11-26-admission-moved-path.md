# Browser admission follows the lean move

> Written by: Claude (opus-rows101), 2026-11-26, meta QA 11-25 row 103.

After the lean move (`f928fdae2`) the MacBook's
`~/.config/wildshard/browser-admission.json` still named
`engine/scripts/browser-machine-policy.mjs`. Engine worktrees took their
sibling provider and never noticed; sharddev, a portable consumer,
imported the dead path and every admitted browser refused with a bare
module-not-found.

The loader now checks the named provider exists. A path in a `scripts/`
folder whose `src/scripts/` twin exists is followed, with one warning
naming the policy file and the exact line to write there. Anything else
refuses with the policy file, the missing path and the lean path it
tried. Two proof tests pin both; they fail on the old loader.

The mini never had the file (t1k, 11-26), so it was on the legacy path
and had nothing to fix.
