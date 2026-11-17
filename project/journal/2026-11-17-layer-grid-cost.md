# Forty real layer creatures freeze with their cell

> Written by: Codex
> State: locally proved, 2026-11-17; ONE-FORMAT OF26e3.

The real GridSimulation enters a cell containing40 actual layered
native skirmishers over Rapier, runs it, then hands its last player to
the highway through prepare/commit. The resident stays loaded. Over
1,200 highway ticks its body/controller/strike/physics/RNG/clock state
is unchanged and its host receives zero calls. Re-entry resumes on its
next native tick. This uses the actual grid interest owner, not a fake
sleep callback. A frozen resident has deliberately detached its player
motor; the fixture reads its creature owners directly rather than
calling the active-host whole snapshot reader on that frozen seat.

The timing file owns the normal all-CPU broker grant before collection.
Its separate timing case runs only at load below6. The measured run
collected at5.944824; earlier high-load observations were not used.
The original native forty-creature proof ran unchanged:

| 1,200 ticks            |  Awake cell | Cell without player |
| ---------------------- | ----------: | ------------------: |
| Actual cell host calls |       1,200 |                   0 |
| Actual cell work       | 73.125710ms |                 0ms |
| Whole grid work        | 73.945000ms |         10.637209ms |
| Cell work per tick     |  0.060938ms |                 0ms |

Cell cost fraction is0%, below5%. The road still costs0.008864ms/tick;
this is not a claim that the entire grid has no cost. The functional
case runs at every load, the timing case visibly skips above the bound.
Exact raw metrics: tmp/codex-te2e/interest-grid-timing.json. Both cases
passed in the JSON test report. One obsolete owned queued run was
SIGTERMed and reaped; no peer grant/process or browser was touched.
Hosted qualification remains with the engine batch land.
