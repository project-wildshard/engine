# NM2: keep native typed lint in the pinned tool cache

The compiler and formatter already use the frozen npm-bin-deps cache.
The native typed lint helper was still duplicated in every engine install.
Removing its direct dependency reproduced a real failure in lint:game:
Oxlint could no longer locate tsgolint and refused the check.
This was reproduced in an isolated pinned clone before changing main.

Move the unchanged oxlint-tsgolint 7.0.2004 pin into binDependencies.
Regenerate the committed tool manifest and lock using normal npr install.
Resolve its installed CLI through the public npr which tsgolint command.
Resolve the package metadata and platform executable with createRequire.
Verify the installed package name and exact version against the manifest.
No code depends on the tool cache's directory naming or internal layout.

Pass the resolved native path at every existing typed lint entry point.
The kit and fix scripts share a small CLI wrapper.
Game, full-tree and staged typed checks keep their original selections.
Existing explicit OXLINT_TSGOLINT_PATH overrides retain their semantics.
The syntax-only gates remain syntax-only and need no native helper.
No hooks, queues, loaders, workflow selection or CPU admission files change.

Keep Oxlint itself as a direct library dependency.
git-rule-counts imports its public RuleTester parser/context API and types.
Moving a CLI must not remove that actual library use.
The format dependency expands its short ref to the same full commit.
Its resolved tarball and all dependency versions stay unchanged.
The expansion was needed to regenerate the historical Git lock reliably.

The existing lint policy proof now checks the public npr inventory.
A real typed CLI rejects an unhandled promise and accepts explicit void.
An explicit missing native executable still refuses rather than skipping.
All three policy cases pass in about 1.3 seconds in the pinned clone.
The real kit typed lint also passes with no direct native lint dependency.
Fresh frozen installs measure 393132 to 371444 KiB in node_modules/.pnpm.
That saves 21688 KiB, about 21.2 MiB, in each local virtual store.
The shared native tool cache still owns one pinned binary; it is not gone.

The full NM2 row stays open through normal publication and hosted greens.
No quarantine deadline, assertion or qualification requirement is weakened.
