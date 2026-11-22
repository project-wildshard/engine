# Run the pinned save and restore proof serially in Ring 2

Run 45003368823 timed out the Nine Dragon Stack save-and-restore
test at 10,007 ms while Ring 2 allowed two workers. Main CI already
isolates the file in its native restore group.

Ring 2 now uses its existing one-worker partition for that same file.
The verdict rejects a passing receipt from a parallel partition. The
seven real restore cases keep their original deadlines and assertions.
