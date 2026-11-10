# Classify the sharding CLI proof honestly

The fixed lift inventory lists `test/vitest-sharding.test.ts`, but this file
contains a command-line program, not a Vitest suite. Both CI workflows already
invoke it directly in their plan jobs. Explicitly collecting it as Vitest
reproduces `No test suite found`, zero tests, after its real discovery/assertion
program succeeds. The underlying program still checks every actual configured
shard phase and rejects duplicate membership.

Rename it to `scripts/engine-ci-membership-proof.ts` and update those two existing CI
commands. Except for its descriptive comment and equivalent relative import, its
program bytes and assertions are unchanged. The tooling directory retains
the existing Node CLI lint rules without adding a suppression or override. Direct full and Ring 1 commands still prove 1198 files/12 shards
and 1113 files/8 shards, respectively, including the hostile duplicate plan.
The full proof necessarily invokes every real configured phase; its observed
collection control took 10.02 seconds. This is the existing explicit CI plan
proof outside hook discovery, with that multi-phase integration reason, not a
new game test or an exception to any file/shard cap.

Remove exactly that old filename from the migration inventory and update the
inventory digest. Owner, first registration and the original November 10
18:00 UTC deadline stay unchanged. There are 384 other paths still requiring
individual disposition. This does not claim those files execute or that a
same-basename/public test replaces their assertions. No other legacy body,
quarantine file, timing weight, rendering path or deadline is changed.
