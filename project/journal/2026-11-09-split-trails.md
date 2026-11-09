# SR10: presentation finds row bodies by their declared names

Herdless pages spawn no population, so declared group lookups returned
nothing: Sky Reach's ray wakes had no bodies to follow (C12), and data
shard client scripts observed the origin and posed nothing (C11).

The server names a row after its declared home or spawn (`far.ray.0`,
`grey-blob:1`), and `wirePage.namedBody` already resolves that name.
Trails and client scripts now ask for the body each frame, because a row
arrives after entry and can come back as another body; a new body
starts a fresh wake. ClientScriptViews reads its target object each
frame for the same reason.

The Template idle script emits particles only while its body is frozen
(`behaviour/idle.as`), which a standalone page never is. So the proof
reads the emitter's anchor, which must sit on the grey blob's row body
and not the origin. Any particle drawn must start there too.

Proof: `split-repair-proof --only=sky-trails` (also `--play`). The wake
check screenshots the same frame with and without the wake material and
compares pixels along the ribbon against a parallel control line.
