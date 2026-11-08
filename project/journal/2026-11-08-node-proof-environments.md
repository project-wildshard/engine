# Native proofs do not need a browser document

CI12 moves stage-reads, quest-capture-stages and quest-world-reactions to
the explicit Node environment after their real import paths pass there.
Their three cases and assertions are unchanged. The same combined command
passed in 1.31 seconds with happy-dom, then 1.19 seconds under Node; this
single spot check is not a broad performance claim.

The remaining server-path quest-reward file contains a real document,
caption and objective lifecycle proof as well as native controller cases.
Its page separation belongs to Opus; do not silently move it to Node or
drop its DOM assertion. Explicit project ownership and a corresponding
outer-edge boundary still remain open in the row. No rendering changes.
