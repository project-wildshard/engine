# 2026-11-19: the page alias list names bootMemorySamples

Lane: buddy-engine (keeper, J443; MAIN RED, run 44558847890, tests (3)).

4d573c835 (EM11, the memory chip and boot peak) added a `bootMemorySamples` page alias to
`bootTrace.ts` between `recordBootCheckpoint` and `startBoot`, but not to the isolated-engine
declarations test, whose list says which originals the aliases capture and in what order (18
expected, 19 found). The list names it in the same place; each original is still captured
exactly once, in order. 201 declaration tests pass locally.
