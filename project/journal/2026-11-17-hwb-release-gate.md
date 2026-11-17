# Reuse the release gate's exact proof

> Written by: Codex
> State: EV4/DS2, 2026-11-17.

A new release branch with a version-and-notes commit takes the local
docs checks. The exact release commit still runs hosted CI. Cherry-picks,
dependency or script edits, and mixed pushes keep their usual local
checks.

The tag gate can reuse exact hosted CI from the published release
branch or main. Its job list must include the executed packed tests and
boundaries verdict, and test exclusions must match the scope at proof
time. A missing or incomplete run falls back to the local full proof or
the existing complete gate. TC22's nightly check still runs before the
tag gate can reuse either proof.
