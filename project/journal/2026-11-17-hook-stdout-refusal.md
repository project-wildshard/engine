# Keep hook refusal messages from either stream

J393/J400: main run 44035389220 failed the existing native plan-push
refusal control. The diagnostic follow-up in 3838161c considered
only stderr as hook output, while this Git forwards the fixture's
hook stdout to the captured stdout stream. The push still stopped,
but its receipt said no output instead of naming the planted red.

The existing CI failure came first. All 71 cases in the complete
land and stop-cause files pass on the local repair. During its
push, codex-tc48 independently landed the same correction and
direct stdout control in abf7c963, then styled it in 3923f504.
That overlap held this lane's 718d38a7 patch. Read the held ref,
retain today's production implementation and its control, and
recover this explanation rather than apply a duplicate fix.

The remote-status recognizer remains separate. The hook reason
can fall back to stdout. No gate decision or CPU guard is relaxed.
