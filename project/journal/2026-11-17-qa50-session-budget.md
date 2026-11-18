# Keep harness walking out of the session bundle

QA50. Engine main run 44226314217 measured 4,401,563 raw session bytes
in boundaries and 4,400,011 in the Template build. The cap is
4,400,000 bytes. After mini-em1c moved optional telemetry out of the
session, the harness route walker could also load only on request.
A pinned walk still uses the same inputs, simulation and trace.
Recheck the captured level scope after loading the walker.

In paired clean Template builds on 7fb254c9, session raw fell from
4,393,606 to 4,392,317 bytes. The 7,683 bytes of local headroom leave
room for the observed Linux build difference. Both build paths now
log exact raw and gzip headroom so the covering hosted run can
verify the reserve.
