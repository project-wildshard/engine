# Keep worktree browser admission inside its checked source

J393: the live J402 pointer names canonical main's private provider.
Vitest in a linked worktree cannot import that absolute module outside
its root. This made unrelated browser helper consumers fail collection.
The exact boot-title-view failure reproduced in a fresh real worktree.

When the running engine carries its own browser-machine-policy module,
load that sibling implementation for the built-in machine provider.
Worktrees and clean gate copies then use their own checked source. The
private configuration and shared CPU ledger stay the admission authority.
Portable consumers without a sibling provider retain the configured path;
other custom module names retain their configured resolution as well.

The new regression creates a real linked Git worktree, starts real Vitest
there and checks that the browser lane loads its worktree provider rather
than the canonical sibling. It opens no physical browser. The three
reported real files pass from both main and a full engine worktree:
boot-title-view, boot-grid-checkpoint and explorer-smoke, 39 cases each.
All existing private-policy refusal controls remain intact.
