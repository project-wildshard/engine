> Written by: Codex
> State: built on plan/tc-pins, 2026-11-15.

Staging CI 43763270760 passed the grid fixture repairs, then exposed the
native verb tape's fixed 20 s child fence under sibling-file load.
Ordinary CI 43763152794 passed that same source. The tape boots six real
SDK workers but was absent from the native file groups. Put it beside
the existing direct-worker proof, where CI runs files sequentially and
keeps their original deadlines. No fence, assertion or CPU cap changes.
