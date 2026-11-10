# Timing observations without a shared-array rebase collision

VB18 follows the real Q257/258/264/265 and later NoN recovery conflicts.
Two independent authors each append valid facts to the final array in
durations-source.json. Git cannot choose an array tail and the queue rightly
reports a real conflict instead of dropping one side. NoN recovery repeatedly
rebased and preserved both histories before publishing e7caccce, whose exact
CI and Ring1 are now green. The six quarantine files remain nonblocking/red.

The recorder now appends each complete successful observation as one JSON
line in test/durations-observations.jsonl. Git's built-in union attribute
preserves concurrent lines without custom user configuration. Existing local
and hosted observations stay in the old file and remain readable. Recording
never rewrites that legacy history or its calibration. The two actual weight
tables retain their current format and can still have genuine same-key
conflicts. No values, caps, oracles or proof fingerprints are weakened.

The reader rejects malformed lines and non-regular/redirected log paths.
The recorder reads the final byte on its append descriptor. It inserts the
missing separator before a new observation when the last valid record has no
newline, preserving that record's bytes. It appends observations before
replacing either weight table. Each table replacement uses its own temporary
file and rename. The log is measurement provenance, separate from code proofs.
Existing source-blob, complete-case, completion-seal, zero/error/skip/stale and
new-ref/restoration admission checks remain in force.

If an append stops mid-line, the next read identifies the malformed line and
leaves both tables and the complete prefix intact. Use the retained sealed
evidence to recover the interrupted record and preserve all complete lines.
Keep the intact metadata in a local commit so the existing clean-tree rule
still applies. Replay the same evidence to complete any missing table update
before publication. The recorder recognizes an exact prior observation and
replays its weight once. A different measured weight still requires a decision
by the owner. This provides recovery from interrupted writes and no claim of
power-loss durability.

The real Git/Vitest proof measures six original anchor modules in both rings,
then one new module in each of two concurrent clones, again in both rings.
The anchors are real completed legacy facts. One baseline line also starts in
the new log without a terminal newline. Both authors record new facts through
the production recorder and rebase through rebaseQueuedSnapshot. Actual
pushes preserve the baseline and four new observations and keep every legacy
byte intact. An interrupted table update replays from the complete log with no
duplicate line. Partial and symlinked logs fail before either weight table
changes. Two independent measurements of the same existing module produce a
real weight-key conflict, which the queue reports by path. Eight actual Vitest
invocations produce 18 clocks in 5.506 seconds. The proof retains the requests,
reports, completion seals and merged/legacy data under ignored tmp.

The existing real timing proof, restoration refusal and annotated-tag/new-ref
controls pass in4.31s,1.89s and2.99s respectively. These manual outer-edge
proofs remain outside hooks. J206 review, the normal full publication gate,
and exact hosted CI/Ring1 still apply before whole-row Progress credit.
