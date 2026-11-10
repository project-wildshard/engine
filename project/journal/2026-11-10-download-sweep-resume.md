# Keep resumed DOWNLOAD readings on their target

The real sweep CLI overwrote sweep.json before consulting its completed
steps. A second invocation against a different full build, URL or worker
mode could therefore relabel earlier readings. Its new identity boundary
refuses that invocation with exit 2 before changing the manifest, report
or completed steps. It also refuses populated output without an identity.
An identical target may resume; missing game readings remain NOT READ.

The outside-hook sweep-input-proof.mjs runs the actual Bash CLI against a
loopback HTTP version endpoint. The original source fails the changed
build control. The forward checks target changes and a same-target resume
without emitting game events or manufacturing a passing reading.

The one-shot review found a real aliasing error in the first guard: URL
normalization could equate /app and /app// although the CLI requested
different paths, and could refuse an unchanged uppercase legacy label.
The real CLI control reproduces that refusal bug before its fix. The
guard now compares the exact request URL already selected by Bash.
Eight outside-hook controls preserve the manifest, report and opaque
prior log; an identical legacy label resumes. Every empty report is
explicitly NOT READ, with no PASS or FAIL substituted for missing data.
The final eight-case run took 1.049 seconds, not the under-one-second
rounding in the source commit message; its bound stays 10 seconds.
The 26 existing report/control cases passed in 1.56 seconds. Typed lint
and the full scripts type project also passed.

The engine no longer declares the phone-loading package command: invoking
it exits 254. The sweep now uses the original frozen source's direct
browser-lane launcher, its max 30 admission and Node's experimental type
transform. Its actual help path succeeds. No browser is needed for help.

This repairs setup, not a DOWNLOAD reading. The quiet-Mac closing sweep,
immutable deployment access, split shell/engine source-map identity and
the relocated programs/digest commands still need their own real checks.
No deadline, cap, network profile, backend or reading oracle changes.
