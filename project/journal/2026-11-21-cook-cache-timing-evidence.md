# Compare stable cook evidence and keep the timings

Scheduled run 44567697455 reached the final cache comparison with the
same cooked bodies. Its warm and cold script maxima differed, as wall
clock measurements should, and the two indexes were judged unequal.

Admitted index equality now separates only elapsed cook time and the
script timing maximum and percentile. It still compares sample counts,
fuel, verdicts, content identities and every client and server object.
The receipt keeps all three cooks' original script timing measurements.
The regression test reproduced the historical mismatch before the change.
