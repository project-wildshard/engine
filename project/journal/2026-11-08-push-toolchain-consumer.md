# Follow the declared compiler toolchain in the hook

The first fresh immutable full gate at e347950 failed in 2.5 seconds:
pnpm exec tsc was absent after the toolchain moved into npm-bin-deps.
The package's typecheck:kit already uses npr, so only the layered hook
command was stale. It now runs the declared local npr through pnpm exec,
keeping both kit programs before layered compilation and four builders.

Fail-fast drained lint, sides and Vitest; no tests or green receipt were
claimed from that red. It is a real clean-install consumer failure, not a
reason to bypass a hook or add an undeclared compiler back to dependencies.

The next clean gate identifies TS7006 in the renderer mirror proof's
untyped cap callback. Declare its existing string input; execution and
renderer behavior do not change. Retain the owner's committed proof and
all its assertions. This removes the observed type gate failure rather
than retrying its unchanged failing tree.
