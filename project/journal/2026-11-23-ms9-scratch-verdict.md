# 2026-11-23: MS9 fixture follows its output argument

The fake QA children wrote into the delivery directory after the deploy
moved their work to leased scratch. Have them follow `--out` like the real
children. Check that the verdicts survive when the child folders are removed.
