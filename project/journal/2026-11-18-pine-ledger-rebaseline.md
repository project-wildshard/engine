# Pine's ledger baseline follows the bytes 3b7611bc moved

Main run 44316540758 (0601e1ac) failed memory-ledger-guard on Pine
Hollow again. Control loading read 127,151,812 B on both guard boots,
against a 120,801,079 B line. This time the cause was codex-memgates'
3b7611bc, which re-landed the phone geometry retire after I reverted
ad52cc05 earlier today, now with the far-herd upload stores retired
from the RAM ledger.

Judged against the baseline, every other zone in that run passed, and
almost all of them read well below their baselines. Pine was the only
zone where bytes moved between subsystems: control scene fell from
6,841,076 to 158,244 B, and control loading rose from 118,432,431 to
127,151,812 B. The two boots were identical and every other Pine
subsystem matched to the byte. On the hosted SwiftShader ledger the
control total is therefore 2,036,549 B higher. The saving the commit
describes shows on Chromium Metal and native WebKit.

The Coordinator ruled not to revert a memory saving a second time and
to re-baseline instead. I moved only Pine's control loading up to the
observed value, and its control and peak scene down to the observed
values, which locks in the scene saving. Peak loading didn't move, so
it keeps its old line. No other zone or subsystem changed.
