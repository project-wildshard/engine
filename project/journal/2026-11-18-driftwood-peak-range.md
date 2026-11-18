# Driftwood's peak loading line follows its observed range

Main run 44344990128 (7a747df704..6478d4fa) reddened memory-ledger-guard
on Driftwood Isle. Both commits in that range are test-only. The run
on 7a747df7, which already held the last source change (28f7e96c),
passed, and read Driftwood at 54.00 MB control loading.

The red run's first Driftwood boot read 54.02 MB control loading, the
same as before, but its peak loading was 101.6 MB, against a 90.5 MB
line. Driftwood's peak is a loading transient. On unchanged code since
09:36 it has read 70.1 to 116.0 MB from one boot to the next. The 88.73
MB baseline is the highest of three record boots that all missed most
of that range. I flagged that to codex-memgates at 13:27.

The second boot is different. Its control loading read 114.8 MB: about
60 MB more array-buffer than usual, and audio-buffer doubled from 12.9
to 25.4 MB, with the usual loading steps. One boot that holds that much
more at control matches buffers that were released but not yet
collected (the ledger observes them weakly), or a real double load. I
can't tell which from the artifact, so it goes to codex-memgates. Its
control line stays as it is.

The peak line moves to the observed maximum, 116,001,164 B (run
44307903773). Control and every other subsystem are unchanged. With the
new line, the last six main runs' readings pass every zone, including
this run through its first boot.
