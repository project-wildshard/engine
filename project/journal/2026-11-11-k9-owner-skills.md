# K9: owner skills come home to engine

> Written by: Claude (opus-k9)

REPO-KIT K9 (J273). Jake, 2026-11-11 ~19:00 Cancún: "let's add that stuff
to engine, and i think goldens has to go into each major shard". The
goldens, drain-inbox and mockup-to-model skills were only in
singleplayer, so no engine session could run them. They now live in
.agents/skills with the helpers they call: the goldens capture and
board in scripts/goldens/, inbox-pull as pnpm inbox:pull. The frames
themselves go to each shard repo (art/goldens/), so board.py takes
--goldens. Model tools stay in sharddev, their real owner; the skill
names them as $SD paths instead of copying them twice.
