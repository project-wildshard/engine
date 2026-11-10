# AGENTS.md: agents below the J241 marker, in sort-sides too

J241 (Jake, 2026-11-10) splits AGENTS.md: Jake's section above a marker
line, the agent section below it. Agents edit only below the marker;
repo-kit's `.githooks/agents-md.mjs` refuses an AI commit that changes a
line above it.

The agent section still opened with the old rule that agents never edit
AGENTS.md; it now says agents edit only below the marker, and README.md
stays humans-only unless Jake says otherwise (coordinator follow-up).

`scripts/sort-sides.mjs` froze all of AGENTS.md. It now rewrites moved
paths only below the marker, keeps everything through the marker line
byte for byte, leaves a file without the marker untouched, and reads
only the agent section for stale names. The new test in
`test/sort-sides.test.ts` passes; that file's 14 older cases were
already failing on main and sit in `test/lift-pending.json` (J200).

A review found the marker matched as a prefix and only the root file was
guarded; the marker must now be a whole line, and every AGENTS.md at any
depth keeps its top.
