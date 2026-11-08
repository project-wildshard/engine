# Keep each real Titan goal under ten seconds

The first full pre-push ran 1,134 files and 5,755 cases. Only the new
Titan successor failed: 11.1 seconds under that load exceeded its
ten-second limit. The other 5,754 cases passed. Nothing was pushed.

The same actual play now has three bounded goals: arrows earn a wind
checkpoint, support melee resumes it and earns fire, and fire contact
resumes that exact save and checks cooldown and spent-cell durability.
Each checkpoint comes from the preceding normal inputs, not a crafted
phase or manually emitted event. Each goal retains the ten-second cap.
There are seven successor cases in total. Publication is rerun with
the entire normal hook and the authorized full suite.

The gate requires a checkout named engine, so the final publication
clone is ~/.cache/wildshard/lift-work/engine-publication/engine. The
earlier engine-tests-publish clone preserves the prepared 893e503.
