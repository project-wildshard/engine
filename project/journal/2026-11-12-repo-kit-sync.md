# repo-kit sync

- Stamped the agent layer from repo-kit v2.2.0: the SubagentStop
  hook stops a finished lane's background shells and the processes
  in its worktree or tmp/<lane> (meta MULTI-AGENT-TOOLING MA11, RK-1).
  Engine's own codebase-design DEEPENING.md edit kept. Landed with
  land.mjs (J240).

- Then repo-kit v2.2.1: the hook also matches Claude Code's '"'"'
  quoting, so a lane waiting on a quoted background command (a land)
  is deferred, not killed.
