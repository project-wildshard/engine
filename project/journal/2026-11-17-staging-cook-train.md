# Staging and its async upload cook move together

SP22 enables async uploads on staging. Keeping cook on production's
older build leaves those uploads staged with no activation. Jake asks
for the cook and staging to move in the same train step.

Before staging aliases a page, move cook to its signed server tag and
exact build. The root helper accepts only a signed staging tag or the
existing version tag; wildshard-apply still verifies its signature and
GitHub commit. Normal rebuild, health and rollback remain. Upgrade an
old helper only from that signed source, through the existing guarded
harden path. A later production finish cannot rewind newer staging.

Red first: actual root-helper fixture refused the staging server tag,
and page go-live accepted an old cook. Both tests pass with the fix.
Policy tests reject a mismatched build/tag and stale production step.
The earlier readiness error handler also needs an unknown annotation;
its initial push caught that lint error and nothing was published.

For v33, the old helper requires a version tag. Once signed production
26 published the already accepted build, its normal cook move ran
before the production page alias; cook == staging at 0f902f76, healthy.
