# The push proof ignores a tree's own pins outputs

A fresh clone's worktree blocked opus-voice2's land (coordinator,
2026-11-10). Its canonical checkout had never written the pins exclude
block, so the worktree's published mounts under `public/` were untracked,
and `push-proof-cache.mjs` refused the tree as dirty. `pins-exclude.mjs`
had promised that untracked pins outputs block nothing, because land and
`worktree new` check tracked files only; the push proof counted them.

Now they agree: the proof ignores exactly the untracked mounts this tree's
own ledger (`out/.pins.json`) lists, plain `public/` paths only, as it
ignores the gitignored `out/`. Any other untracked file still refuses, and
a tracked file the ledger names still counts when it is modified. Test:
`test/tooling/pins-exclude.test.mjs`.

J206 Codex review: a ledger alone could whitelist any untracked file, and
the passed-over bytes never entered the proof identity. Now a mount is
passed over only if this tree's pins manifest lists it, the manifest's key
is still this tree's committed pins and installer, and the file hashes to
the manifest now; the manifest key joins the proof's runtime identity, so
a pins change never reuses an older green receipt.
