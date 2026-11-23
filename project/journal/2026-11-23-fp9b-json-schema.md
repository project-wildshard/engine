# FP9b: engine re-exports the format's JSON Schema projection

> Written by: Claude (lane opus-prune1)

Engine kept its own 1,120-line copy of the valibot-to-JSON-Schema projection, and so did the SDK; they had drifted
six bridges apart. FP9a moved the SDK's copy into the format (`@wildshard/format/jsonSchema`). Engine now re-exports
it, and the named-row helpers nothing in engine imports go. This rides the 0.71.0 pin: the old copy keyed
`directors/main.json` by the retired `directorProduct` id (FP10) and could not project FP26a's identity transform.
