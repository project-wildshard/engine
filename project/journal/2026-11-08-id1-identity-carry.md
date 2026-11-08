# Carry identity from the preceding progress epoch

ID1 is outside the wire-format start gate and is authorized now. The page
opened each new epoch's IndexedDB correctly, but always looked for the stable
device identity in the epoch-zero database. A player whose current identity
was in epoch one therefore lost it on the next bump, or picked up a stale
epoch-zero identity.

Share the existing epoch-to-database naming rule and read epoch minus one
when the target database has no identity. The stable device key is unchanged,
and an identity already in the target database still wins. No progress or
other save keys are copied. Epoch one still reads the legacy database.

The existing explicit browser proof now seeds different real identities in
epoch zero and epoch one, installs a scratch epoch-two app identity and
checks the booted public device identity. Before the production fix both
Chromium and WebKit were red: stale-epoch-zero instead of epoch-one. After
the fix all four browser cases pass, covering zero-to-one, one-to-two,
durable target reopen, latest name, two-to-three and progress isolation.
Each new case stays below ten seconds. The proof is not added to any hook.

The normal full pre-push, outgoing scan and SSH keepalives remain required.
No wire field, epoch value, save wipe, UI, release upload or deployment changes.
