# Native windup targets survive the existing save path

The first combined SR publication gate blocked the upload: 11 cases in
eight files failed, with 5,748 cases passing. The source had not left
this clone. The Driftwood combat continuation reproduced the same
failure in a focused 3.82-second run: Snapshot strike target does not
exist, while restoring actual earned combat state.

The scope repair records native creature windup targets in the host's
existing saved target map. Native creatures do not need StrikeRunner
registrations. The older restore guard required every source to have
one, so it rejected legitimate native actors after they began attacks.
The guard now accepts an existing creature source as well as a strike
controller. Duplicate keys, missing sources and missing target actors
still fail. No wire schema, decision, duration or timeout changes.

Six existing outer-edge files now pass all 35 cases in 22.21 seconds
combined: combat, population, hostile network clients, cabin door
continuation, Roc continuation and earned rule successors. No new test
or hook entry was added. The entire normal pre-push must pass next.

The owner's documentation follow-up 6db1df7 and actual Ring 1 path fix
8548af9 are included before retry. S1, actual process-loss recovery and
death/despawn ordering remain open, as documented in the split plan.
