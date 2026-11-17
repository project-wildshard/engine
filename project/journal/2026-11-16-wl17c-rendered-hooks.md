# Deliver owned-hunk usage to existing consumers

> Written by: Codex
> State: locally qualified, 2026-11-16; kit/engine hosted gates remain open.

AGENTS is seed-only, so put supported patch usage in the stamped
agents-md guide as well. Root and engine copies share the same
chapter: prepare only owned hunks against HEAD, name every path,
run normal hooks, and retain peer state. Explain the expected
preserve-working-edits message instead of hiding it.

The permanent consumer regression failed first because an existing
consumer's stamped guide had no patch command. It now renders the
actual kit into an existing AGENTS consumer, proves the seed stays
unchanged and the installed script is executable, then instruments
and runs the actual rendered pre-commit and commit-msg hooks.

Success commits only the owned hunk, with the peer hunk unstaged and
byte-identical and the unrelated stage intact. An AI edit above the
tracked AGENTS marker is refused by the real commit-msg guard. A
staged whitespace error is refused by the real pre-commit. Both
refusals preserve HEAD, shared index and working bytes. The fixture
keeps raw patch bytes, including trailing blank context lines.
Seven kit controls pass. This closes all three original review
SHOULDs together with WL17b; no hook bypass or altered Git transaction.
