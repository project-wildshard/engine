# Keep the shared-push fixtures and quarantine contract portable

> Written by: Codex
> **State:** prepared, 2026-11-16. Mini M2, main43965567759.

Tests1 failed because the real main-push helper clears inherited
GIT_* state. Fixture commands supplied author environment variables,
but helper commits relied on the Mac's global identity. Configure
the existing throwaway clones with their existing fixture identity;
never alter the runner's or developer's global Git configuration.

Tests2 failed the original land workflow contract: my empty-policy
quarantine guard changed the shape of the main-only docs guard.
Keep that exact guard. Publish the active-policy value as code.run
instead; an empty policy still skips setup, dependencies and pins,
and an active non-docs job runs the original cohort. Preserve every
existing test assertion and all blocking test selection.
