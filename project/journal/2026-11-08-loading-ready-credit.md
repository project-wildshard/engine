# Keep the final measured reading at control-ready

A real throttled Chromium Dunes boot reached ready in 24.9 s with no
two-second stall, backward movement or page error. The strict oracle
rejected one 99.8 percent Load reading. Its original producer rows
independently earned exactly 99.8: the server row was done while the
enclosing finish row was still open. The real control-ready mark had
just been emitted, before done closes that parent stage and paints 100.

The proof incorrectly demanded 100 immediately upon seeing that mark.
Keep checking the exact row-derived fraction, and also admit final 100
only after the real control-ready boundary. This is not a tolerance or
a range: an arbitrary 99.9 still fails, as does 100 before control-ready.
Labels, unrelated counters and false denominators remain rejected.
No runtime or presentation code changes. Replaying the exact retained
real boot now yields zero untraced changes. The focused collector and
bar-law files pass ten cases in 224 ms; fresh strict boots follow.
