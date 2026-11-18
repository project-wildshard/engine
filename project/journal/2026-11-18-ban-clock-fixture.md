# Ban-card fixture clock

> Written by: Codex
>
> **State:** verified 2026-11-18. Main-watch M2, FM8m.

Engine main run 44321617109 reached the banned-end assertion after the
fixture's fixed deadline. The production card correctly hid the expired
time. The test now fixes its own wall clock, exercises a future, expired,
and missing deadline, and checks that each card offers the Title screen.
