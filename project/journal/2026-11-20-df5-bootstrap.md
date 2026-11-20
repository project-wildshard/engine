# DF5: seed the workload before page boot

> Written by: Codex
>
> **State:** implementation, 2026-11-20.

The first cooled phone attempt reached control at 35.29 °C, but the
actual game was High at DPR 2 despite Low fixtures seeded on robots.txt.
The workload witness rejected it before route sampling. Safari parked
on about:blank and the locks released. Its viewport was 390×658, so the
three provisional 390×664 Mac captures cannot qualify a matched fit.

The Inspector driver now offers an explicit bootstrap script. It runs
before new documents read saves, and provisional targets receive it
before resuming. This uses Page's bootstrap command without enabling
the Network agent during measurement. The DF5 collector opts in with
the same Low fixtures and seed used by the Mac arm; it still requires
the actual Low, DPR and shadows-off witness before sampling.

Seven protocol and phone-harness checks, scripts typechecking and lint
pass. Tests verify bootstrap ordering before provisional resumption,
no Network agent activation and a hard setup failure for an unsupported
command. Real phone qualification remains required.
