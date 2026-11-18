# One pin change now rebuilds one product

Changing Brasscap Mesa from revision 6 to revision 4 used to admit all 27 pinned products. The installer can now retain the other 26 after checking their files, receipts and public mounts against the last complete install. The shared inputs still have to match, including the validator, installer, pin membership and tracked public paths.

In the same worktree, the pin edit took 2.37 s and a full admission took 13.97 s. Both wrote identical manifests and mount ledgers. Removing Dunes' validation receipt rebuilt Dunes alone. The original tracked pins were restored after the run.
