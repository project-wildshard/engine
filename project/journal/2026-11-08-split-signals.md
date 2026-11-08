# SR8: native population signals reach the page

Native population outputs had no ordered route to the existing page
sound and riding-panic consumers. The server now sends actual signal,
sound and knockdown outputs as fight views. The page rejoins the existing
creature.signal, creature.sound and creature.knockdown event contracts.
The authoritative knockdown dash remains on the server.

GroupNotices now lives in shared code. Its authored cooldowns use the
view tick clock and produce creature.notice {text} for the UI owner.
Opus must display that notice and the knockdown flash. Do not apply a
second dash in the page consumer. This commit adds no visible UI.

Three fresh real Nalati runs per browser passed in Chromium and WebKit.
Actual bow hits provoked the wild herd, producing stampede signals,
marmot_whistle sound, knockdowns and the Stampede!/Knocked down! notice
data. Every run observed at least one knockdown. The proof observes the
events; it never emits one. The manual selectors are worker-client-proof
--play --only=nalati-signals and split-repair-proof --only=nalati-signals.

The separate guardian check failed in both browsers: zero dog_bark events
after 300 seconds of actual play near the guardian. The first authored
raid is 150–240 seconds, so this long manual wait is genuine simulation
work, outside hooks. It is not a green proof and its cause is unresolved.
The manual guardian selector retains that failing acceptance check.
The horse-bitten panic play check has not run; S6 remains open. Source
connectivity alone does not satisfy that play requirement.

Types, lint and the 1665-file engine-side inventory pass. The focused
GroupNotices check passed in 266 ms; all 28 products built successfully.
No manual play proof was added to a hook. The combined SR1+SR7 one-float
proof also remains with the SR1 owner; this clone has zero floats before
that owner's adapter. Publication and the full pre-push suite remain
held until v0.1.1 exists. No acceptance row is marked done by this note.
