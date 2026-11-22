# Check the actual green release source for changes

With v0.1.70 on staging, the v0.1.71 dry run saw one new commit on
main. The new commit was red, so the dry run selected the same green
source as v0.1.70 and would have cut another version of it.

Check the selected green commit against the last prepared or tagged
release before starting a fresh cut. The check also runs for dry runs
and explicit on-demand cuts. An existing prepared release still uses
its exact-source resume path.
