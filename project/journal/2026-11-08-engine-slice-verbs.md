# EG-9: run the existing verbs on server slices

Written by: Codex. 2026-11-08. Public base 9059d6b, fresh engine clone.

The lift already supplied the builtProduct slice fallback. Three existing
network verb suites still eagerly read every indexed asset, including
GLTFs which a server slice deliberately omits. The real slice-only run
failed on missing Pine/Nalati GLTF files before reaching the verbs.

Use the same eager runtime asset class as the standalone worker and the
other lifted proofs. The nine remaining act, door and chapter cases pass
on Ring 1's pins/slices in 6.14 seconds for all three files. Each case is
bounded to ten seconds. Remove the chapter test which spied on a private
ReturnProgram method's invocation count: J186 rejects that oracle.

Move those three suites out of the Ring 2 list. Do not move all 48 old
files blindly: native replay helpers still demand complete asset tables,
and long taming journeys are not under ten seconds. Their reasons stay
explicit in the meta coverage rows. No shard source was read or linked.
