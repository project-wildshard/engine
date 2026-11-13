# Every pin output is ignored, not only the canonical checkout's

Land stopped twice tonight on "tree not clean after scripts/gen.mjs
--inputs-only" (opus-sam1b, then opus-shardsize). In a plan worktree,
gen wrote pinned shard assets as untracked files: Nalati's
`public/assets/gpu/nalati/` copies and the shared
`baked/common/cloud-field.bin`. The canonical checkout never sees
them, because its `info/exclude` lists every file pins ever wrote, and
a worktree has no such list.

opus-pinignore moved most of that list into `.gitignore` on 11-11; 118
of the 1190 public paths in `info/exclude` were still only there.
`.gitignore` now names them as well. Three folders hold pin output
only (`gpu/nalati/`, `music/folk/`, `music/orchestral/`) and are
ignored whole. The other 66 files sit beside tracked ones (the cloud
field and water ripples, Pine's navmesh and sky, the HDRI key files,
the Poly Haven model copies, piano music, Nine Dragon's lab) and are
ignored by exact path.

`test/tooling/pins-ignore.test.mjs` names the reported paths. It was
red on the old `.gitignore`, and its other case still holds: no
tracked public file matches.
