# FL16: bound repeated checkpoint compression to one world

Awareness still performs the original 3,977 inputs and native replay.
Its post-promotion hosted file clocks were 61.321 and 70.503 seconds.
All assertions passed; the unchanged 60-second file budget did not.
The original quarantine window still expires today at 12:37:14 UTC.
This source change neither renews that window nor claims qualification.

Direct worker CPU observations measured 16 serializations at 10.097s.
The same 16 captures used 147ms, so skipping capture is not justified.
Across actual checkpoints 2,398 of 3,869 framed blocks repeat exactly.
A world-owned writer now retains copied raw blocks and encoded strings.
A hit requires the exact raw length and every raw byte to agree.
The cache key is not a digest, slug, tick, revision or caller buffer.
Every miss uses the original independent compressor and fresh level-six options.
The retained prefix avoids an LRU that churns on oversized continuations.
Payload accounting includes raw bytes plus two bytes per encoded character.
The fixed payload bound is 48 MiB; over-budget suffix blocks bypass retention.
Owner disposal clears retained blocks even when world disposal throws.
No world, stream, dictionary or mutable caller view crosses owner boundaries.

The public stateless and staged page writers retain their existing behavior.
The new snapshot facade only binds the existing current API version.
Native proof and both production headless compositions own the same writer.
Wire format, API version, checksums, framing and strict refusal rules stay put.

The first distance-one dictionary pilot was byte exact but not faster.
It is rejected and its snapshotPhysics source was restored byte for byte.
The retained memo ABBA whole cases were 20.177/20.640s reference,
16.872/16.777s candidate: about 17.6 percent lower across these local runs.
All sixteen complete saved wires match in each original story.
All original inputs, replay parts, native states and digests remain checked.
These local numbers are not a hosted tail-latency guarantee.

Twelve complete-save parity controls cover cold, warm and independent owners,
unaligned input, same-length mutation, basis contexts, disposal and refusals.
Seven manual memory/context controls reach a 32,000,000-byte raw input.
Peak retained payload is 50,117,176 of 50,331,648 bytes, then zero on disposal.
Fresh real compressor options and independent owners are observed directly.
The 24 existing outer-edge cases pass across four files in 4.16 seconds.
The retained additions share existing cases, without a new slow test path.
Typed lint and full layered types pass; all original deadlines are unchanged.

J206 one-shot review has no MUST or SHOULD findings and wrote no files.
Review: pinefix2-channel-proof-FL16-scoped-compression-20261110T085230Z-45728.
Actual reports remain in own tmp/fl16-codec pending compact meta evidence.
Ten fresh authoritative hosted file passes are still required after publication.
FL16 remains open; no policy, deadline, planner or cap changes are included.
