# Preserve hook stdout in refusal receipts

> Written by: Codex
> **State:** fixed locally, 2026-11-17.

Engine main run 44035389220 at f840ba45cd failed tests (7).
The real Git fixture correctly refused its planted red pre-push, but
the receipt said "no output". Git delivered the hook's message on
stdout while stderr contained only its generic failed-push footer.

Keep actual remote porcelain rejection first and retain stderr's
existing RED/error priority. When neither names a cause, use the
last non-Git stdout line. Passing sample trailers on stderr still
cannot masquerade as a remote rejection. No gate decision changes.

Both the original real-Git case and the added stdout control failed
first locally with the exact hosted "no output" receipt. Preserve
the original refusal, zero Actions calls and unchanged remote main.
All 71 landing and stop-cause cases then passed in 92.42 seconds.
