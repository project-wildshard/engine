# The cook can enter its own checkout

MMO-SERVER MS2.4b. On the box `wildshard-cook.service` failed with
200/CHDIR: `/opt/wildshard/engine` was 750 root:root, and the worker
runs as `wildshard-cook`. Root clones the checkout under the box's
umask 027, and `make_cook_source` only took write bits away
(`chmod -R go-w`), so nothing ever gave the cook's group a way in.
Jake fixed the box by hand (chgrp, chmod g+rX); then the worker
started and its git refused the root-owned repository ("dubious
ownership").

`rebuild.sh` now has its own step, "cook source readable by
wildshard-cook": root keeps the checkout, its group becomes
`wildshard-cook` with read and traverse, and neither the group nor
anyone else writes. The step checks with one `find` that stops at the
first wrong entry, so a box that is already right is a quick ok. When
it repairs, the worker restarts as it does for a new checkout. The
worker's hash of `cook.env` (`.wildshard-env`) stays root's, and
symlinks keep their own modes. The unit gets git's `safe.directory`
for the checkout through `GIT_CONFIG_COUNT` and the matching key and
value variables, so no gitconfig is needed in the worker's home.

`test/vps-rebuild.test.ts` builds the umask-027 shape in scratch
(750 directories, 640, 600 and 664 files), sees the check fail, runs
the repair with a group of the test user's, and reads back 750, 640
and 644 with that group, the hash file untouched. The unit's
safe.directory line is pinned beside it.
