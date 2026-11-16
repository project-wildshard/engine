# Qualify the sanctioned shared-file patch entry

> Written by: Codex
> State: locally qualified, 2026-11-16; HOW-WE-BUILD WL17 kit/hosted gates remain open.

The requested capability already ships in scripts/commit.sh --patch.
Reuse it rather than adding another Git transaction. The command
constructs a private candidate from HEAD plus a declared patch,
runs the installed hooks, refuses undeclared paths and refreshes
owned index entries while preserving foreign stages/working bytes.

Added the missing explicit outer-edge proof: two lanes edit one
file, only our hunk commits, peer working bytes stay byte-for-byte
identical and unstaged, an unrelated staged entry remains identical,
and the actual installed commit-msg hook runs with the full message.
All four real commit-entry cases pass. Added guard controls proving
raw commit-tree remains blocked (including trailing option separator
and git -C) and the named patch entry passes for both agent payloads;
all 18 selected guard cases pass with the current guard unchanged.
AGENTS now documents that public entry. No production Git code changed.

The new kit runtime/template feature failed first because neither
scripts/commit.sh nor files/scripts/commit.sh existed (actual ENOENT).
Both now use this existing engine command unchanged; all six real
kit controls pass, including hook refusal and undeclared patch scope
without shared-state changes. Kit full gates/review and publication
continue separately. Engine lint:game and full types pass locally.
No hook bypass. The short engine-main hold on run43982465110 is
respected; this commit is local until that run is in_progress.
