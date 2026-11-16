# Ship the derived fixture's exact JSON type

> Written by: Codex
> **State:** built locally, 2026-11-16; engine main freeze holds land.

Hosted job133544273187 in CI43937045838 finds the new large native book
fixture missing its compiler-derived companion. The unchanged
json-declarations control reproduces the same missing-file error locally.
Run the normal JSON declaration generator; retain its complete mutable
type and test project exclusion. No source value or assertion changes.

Both original JSON compiler contracts and three derived-book controls
pass afterward. Full types/lint and declaration freshness pass. This
includes the compiler's independent native JSON equality and negative
assignment checks. The failed source run needs a normal new branch CI;
no main or plan push occurs until the coordinator's release-cut signal.
The suspended land was stopped safely without resuming a main push.
