# Keep the GPU recovery proof in the scripts typecheck

> Written by: Codex
>
> **State:** verified, 2026-11-20.

DF6's pre-push scripts check exposed four implicitly untyped parameters
in the canvas-readback override. Annotate the coordinates and dimensions
as numbers; the recovery probe's runtime behavior stays unchanged.

Validation: scripts typecheck and root lint pass. The push gate checks
types, lint and related tests on the clean candidate.

Lane: codex-tc48.
