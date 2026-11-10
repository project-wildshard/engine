# Quest dialogue follows grid home entry

The retained SDK lifetime fixture drove RetainedRuntimeHooks directly.
Its successor instead enters/leaves real GridCellEvents, which drive the
actual HybridShardPlugin owner, and constructs the real QuestViews and
DialogueBox. The authored probe is deliberately only dialogue: no empty
world is claimed as a playable shard or a renderer proof.

Both original cases remain: duplicate/stale names, scoped dialogue and
timers, leave and reentry, modal clock replacement, ordinary teardown,
dead-owner refusal and every quest placement intake refusal. New checks
observe DOM, real due timers, input and completion rather than private
listener counts. A neighboring cell cannot reactivate the home. Return
retains the authored plugin while recreating its entered widgets.

The two cases take 36.69 and 3.41 ms locally. Each keeps a 9.5-second
whole-body elapsed check and timeout, outside local hooks and Vitest
inventory. Removing only the real hybrid leave hook causes the first
case to fail at stale dialogue access; the ordinary case still passes.
The original SDK file and its exclusion ratchet remain untouched.

Happy DOM page timers are borrowed and restored with the other actual
page globals, so teardown closes the page and its timers. No browser,
server, socket, source generator, product byte or pin is changed.

J206 one-shot review reports no MUST-FIX and maps every inherited
assertion. Its two SHOULD items are fixed: malformed placements must
name their own failure (a later missing-world refusal cannot pass), and
nested finally cleanup restores global descriptors and disposes the
scope even if another cleanup fails. Targeted lint explicitly documents
Node-only imports; Node owns each registered test promise.

Review: `~/.cache/wildshard/session-keep/reviews/sdk-quest-engine-20261110-SDK-quest-home-20261110T023008Z-89693.md`.
