# New refs reuse published history for timing admission

The v0.1.5 tag targets an existing published main commit. CI23 treated the
all-zero old tag ref as an empty repository and required clocks for every
historical test, including an existing modified net-strip file. The full green
suite could not publish the tag. Net-strip was added by 8271232; its addition
was not part of this push.

New refs now compare against their merge-base with the push destination's
advertised main. A tag already on that main has no new files. A diverging new
ref still requires clocks for its actual additions. Missing, inaccessible or
unrelated main history retains the conservative whole-tree check. The bounded
read hydrates a missing advertised commit without changing source, HEAD or
tracking refs. Existing-ref ranges and timing validation are unchanged.

Git's hook passes its actual destination URL, including distinct fetch/push URL
configurations and direct URL pushes. Ref admission still runs before proof
reuse; the destination, like the pushed ref names, does not change an existing
full-tree execution proof. No skipped/zero-test result becomes a timing.

The new outer-edge CLI proof performs real annotated-tag pushes to private bare
repositories through the actual timing helper. Before the fix the published tag
is refused for the historical file. Afterward it passes, including with a
missing tracking ref and an independently advanced remote main whose commit
must be hydrated. A genuinely new unpublished test and an empty alternate
destination still refuse. No products or browsers are involved; this manual
proof is outside commit/push hooks.

The one-shot review caught use of the remote name instead of the actual push
URL. A split fetch/push repository control reproduced that unsafe admission
before the correction. Both split directions and a direct-URL push now run
through the same actual hook destination used for lookup and hydration.

The complete new regression completed in 2.806 seconds. The existing actual full/Ring 1
timing-evidence proof passed in 3.984 seconds, including its missing, skipped,
zero, stale and unhandled-error refusals. The existing exact-tree cache CLI proof
also passed. Script project types and the normal selected typed lint were checked
separately before publication. Full publication and hosted results are reported
in the lane receipt after the queue settles, rather than inferred here.

Release ownership remains with codex-port. No tag, deployment, settings or
quarantine change is part of this forward.
