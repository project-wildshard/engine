# The stuck-step watch waits while PLAY is up

Jake on his iPhone (preview, solo 0641eaa, engine a479f38): with
Developer ▸ Hold at loading screen on, the card held at 100% with PLAY
up, and a minute later the fatal modal said the game "stopped loading
at step "gap" (no progress for 60 s)" and sent a report. "When the play
button is ready, you don't need this error state."

Cause: `watchStuckStep` (src/client/engine/boot/stuckStep.ts) only
knew progress or no progress. The held card is complete, so nothing on
it moves, and `start()` (src/client/app/entry.ts) stays pending until
PLAY, so the watch ran out its 60 s bound on a boot that was only
waiting on the player.

Fix at the watch: its progress reading now says whether the boot waits
on the player. `progressOfCard` reads `data-ready="true"`, which
Loading sets only while `waitForPlay` shows PLAY and clears on proceed.
While it is set no time counts; when loading goes on the bound starts
from zero, so a real hang after PLAY is still named. No special case
for the step name "gap".

Tests: unit (held 5 min, no stall; release, then a 60 s hang trips),
the same card without PLAY still trips, and the real Loading card held
past three bounds trips nothing. Both new hold tests fail on the old
watch.

Codex review (J206): no MUST-FIX. Took its SHOULD: the hold tests also
assert the card stops reading as a player wait the moment PLAY, Hold
off or Developer off releases it, so a stale data-ready cannot mask a
later hang.
