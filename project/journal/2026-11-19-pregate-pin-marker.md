# 2026-11-19: main-push's early gate carries the FS18 marker

Lane: buddy-engine (Coordinator; opus-of19b0 needed ALLOW_PIN_PUSH=1 for d2cef3cd8).

FS18 (9b5ab390e) lets pin provenance pass a `test/pins` change that main-push sends from a clone
on main: `pushMain` sets `WS_LAND_MAIN_PUSH=main-push:<HEAD>` for its `git push`. But main-push
runs the pre-push twice: once early, outside the lock (`pregate`, da56ff9e9), and that run
built its own environment without the marker. The early gate refused every pin re-record with
"no origin/plan/* branch carries these pins", the refusal that recommends main-push itself.
engine-quickfix kept the log (`.git/main-push-gate-73257.log`, 04:12 Cancún).

`pregate` now sets the same marker for its HEAD. A probe in a private clone showed the hook
itself passes main-push's marker; the new test pins that the early gate hands it over.
