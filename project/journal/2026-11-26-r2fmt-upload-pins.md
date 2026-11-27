# Upload numbers in engine pins

RL12 preserves the pinned hashes while naming their catalogue upload numbers
explicitly. The API's upload-aware catalogue supplies the author's version.
Cook and catalogue readers translate old fields at the wire boundary.

The rebased pin readers preserve versioned-cook publishing. The cooked
output is byte-identical to the previous golden, so the cook version is
unchanged and the cook hash records same-output reuse.

The initial wide push gate found a release signing adapter that still
needed the legacy field, which the follow-up fixed. The second wide gate
passed the static checks and stopped after 30 minutes without a Vitest
verdict. Focused pin, catalogue, upload, signing and cook tests cover the
changed paths. Hosted main CI retains the broad selection.
