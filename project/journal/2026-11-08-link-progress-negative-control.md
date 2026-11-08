# Make the link test detect a sleeping reconciler

Written by: Codex. 2026-11-08. EG-22, J186.

An actual negative-control edit disabled Predictor.reconcile in this owned
clone. All three original link cases still passed: two metres of movement
and an upper bound on a diagnostic that never updated were insufficient.
That is a weakness in the new test, not a production predictor fix.

Follow the real product's forward spawn heading inland, sustain six metres
of movement, release input for forty-five real link ticks, and require the
predicted character to finish within twenty-five centimetres of the real
server. The same disabled reconciler now fails. Restore the actual source
and all profiles must pass with their unchanged ten-second case deadlines.
No temporary fault or private queue assertion is committed.
