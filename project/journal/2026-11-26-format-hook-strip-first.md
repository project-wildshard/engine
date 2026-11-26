# Sim threads stop loading the TypeScript compiler on Node 26 (opus-node26, MAIN RED 45763617326)

- Row 95 put every CI job on Node 26, and the two native tape-worker tests passed their fence (status null: the child
  was killed at the timeout after printing its pass line).
- Node 26 dropped `stripTypeScriptTypes` transform mode, so format-hook.mjs required the whole TypeScript compiler in
  every sim thread for the installed `@wildshard/format` sources. A thread's import took 1130 ms on 26 against 600 ms on 24.
- It now strips first and calls the compiler only for a file with an enum or a parameter property (none in today's
  installed packages): 460 ms on 26. The tape tests pass on 24 and 26; format-hook-runtime.test.ts fails without it on 26.
