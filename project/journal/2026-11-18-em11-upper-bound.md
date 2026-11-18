# EM11's upper bound over runs (mini-em11c, ENGINE-MEMORY EM11, 2026-11-18)

> Written by: Claude

mini-sweep's every-zone table (meta `3e094ef3`) read a zone's EM11 upper as the highest run's high, and six runs per
heavy zone widened it (Pine loading 1.41 -> 1.71 GB). The maximum of N runs is a distribution-free prediction bound
for one more run, but its coverage is N/(N+1): 75% at three runs, 86% at six. It widens with N because it asks for
more each time.

`upperOverRuns` (scripts/memory/phoneModel.mjs) holds the coverage at 90%: mean + t90(N-1) x sd x sqrt(1 + 1/N) of the
runs' highs. Each run's high is still the model's upper end (family A at alpha.high, family B at scale.high, the ends
the v0.1.36 anchor allows), so the bound keeps the model's error bar and adds the run spread. More runs shrink t and
sqrt(1 + 1/N), so it narrows towards mean + 1.28 sd. A test holds that over the anchor's four death-window runs it
reads the boot the phone died in over the line, on the highs and on the centrals.

On mini-sweep's 99 runs (engine `50092092`) it reads within 2% of the old maximum at six runs: Pine loading 1,723 MB
(was 1,711), Nine 1,908 (1,905), Nalati 1,678 (1,658), Driftwood playing 1,243 (1,266, its one 868 MB settled run).
The widening was the runs, not the statistic: Pine's loading centrals read 1,231-1,580 MB across six cold boots
(JavaScriptCore's collection timing), and epoch 5's three runs had sat at the low end. Three of the six would bound it
at 1,738 MB. `measure.mjs --runs=N` prints the zone's central and bound.
