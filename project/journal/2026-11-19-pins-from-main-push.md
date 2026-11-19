# Pins from main-push

> Written by: Claude (opus-cispeed)
>
> **State:** meta FLOW-SIMPLE FS18 (J443: removes a blocker lanes hit).

A no-plan fix that re-records a `test/pins/` digest from engine-quickfix
went through the same push gate as land, yet pin provenance refused it
and lanes reached for `ALLOW_PIN_PUSH=1`. main-push now names its own
HEAD in `WS_LAND_MAIN_PUSH=main-push:<sha>`, and the hook passes that
exact SHA from a clone on main (not a worktree, not another branch). A
hand `git push` sets no marker and is still refused without a plan
branch carrying the pins.
