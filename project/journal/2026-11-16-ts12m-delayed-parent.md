# Join command CPU across delayed parent bookkeeping

> Written by: Codex

> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS12m.

The parent's rusage receipt stamps reap time after wait returns. If that
parent is descheduled, the observer can finish before the stamp. The raw
same-owner drain already proves actual reap, including Linux zombies.
Qualification now permits this ordering while requiring the producer proof
to fall inside both the command and observed lifetimes. No tolerance is
added; identity, drain, lease, full-scope and successful-rusage checks stay.

A real wrapper is deliberately delayed after wait until the recorder ends.
It qualifies with its original command CPU. A live unreaped zombie held
through the observer deadline refuses; the normal three-sample zombie
control still drains only after reap. The 25 existing metadata refusals and
two additional proof-window refusals remain green. These are fixture-only
controls, never a complete engine gate or a ten-gate sample.
