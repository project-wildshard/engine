# Restore the strict production cook inventory

Source 80d5cc0's hosted Ring-1 cook-step fails before it cooks a product.
The failed job is 128777762636 in run 42495800179.
Its exact diagnostic names a dynamic import in bake-input-hashes.mjs.
Calling the real cookRevision on canonical main reproduces the refusal.
The independent native step witnesses pass, but that cannot green the job.

The renderer inventory imports source-input-proof for a committed file list.
That module imports InputHashMemo from the recorded-bake refresh module.
The strict producer walk therefore reaches the refresh CLI's dynamic import.
That import predates this change and is not a production cook dependency.
The walker correctly refuses a module containing an unbounded import.

Extract the existing memo and exact input hashing code into one leaf module.
Its code, stat identities, read fences, snapshots and failures are unchanged.
Point source-input-proof and its declarations at the side-effect-free leaf.
Keep the original bake-input-hashes exports as aliases of the same objects.
Recorded bake refresh and its explicit CLI remain in their original module.
No dynamic-import exception or closure-walker relaxation is introduced.
No duplication of memo implementations or cached mutable worlds is added.

The actual cookRevision now resolves nineteen producer inputs successfully.
A mirror containing those exact source files yields the identical revision.
Changing the real memo leaf in that mirror invalidates the revision.
Adding a nonliteral import to its entry still produces the strict refusal.
The source import walker itself is untouched.

The real production Ring-1 Dunes cook succeeds in 29.9 seconds.
It publishes twenty-two store objects and a server pack with its receipt.
Its unmeasured proof label is preserved, as permitted for the native product.
The two existing hash/source-evidence files pass all ten cases in 0.932s.
Focused root-config typed lint and the full layered typecheck pass.
Required generation refreshes the conservative renderer input stamp.
An actual whole Ring-1 cook batch and hosted checks follow this commit.

The coordinator assigns the breaker fix before further quarantine work.
The FL plan tracks it as FL19; it is not done until merged and both hosted
ci and ring-1 are green. The fifteen quarantine entries and deadlines stay.
No release CI reruns, hook bypass, API upload, UI change or deployment occurs.

The complete real cook batch also passes: Template proved in 13.7s,
Blender Template proved in 25.7s, and Dunes unmeasured in 26.7s.
The normal immutable hook passes all 5,818 tests in 272.8 seconds.
Its post-hook source fence then correctly refuses the generated stamp drift.
Running gen:inputs on canonical source reproduces that tracked-file change.
Commit the fully tracked helper inventory's generated renderer stamp forward;
a second generation produces identical bytes. Do not bypass the source fence.
The immutable queue must validate and publish this complete source again.
