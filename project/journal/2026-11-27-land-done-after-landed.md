# land --done after a land that already went through (QA 11-26 row 15)

Lane opus-qa-tools. opus-junk landed row 14 without `--done`, then ran
`land.mjs --done` to remove the worktree. Land saw nothing to land and
returned before it recorded a landed SHA, so its cleanup said "nothing
landed" and kept the clean worktree; the reaper refuses while the session
lives. A branch already on main (every commit there, whether an earlier
land pushed it or a rebase emptied it) now counts as landed at its HEAD,
so `--done` removes the worktree and its branch under cleanUp's usual
guards: on its branch at that SHA, clean, copied first, nothing running
there. Without `--done` the worktree stays, as before.

Guard: `test/land-cleanup.test.ts` "meta QA 11-26 row 15".
