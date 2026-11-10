# NM6: keep Binaryen API, omit unused tools

The public pre-bundled Binaryen nightly is now available on npm.
Its exact version is131.0.0-nightly.20260721-patch-1.
The root override changes only assemblyscript>binaryen.
AssemblyScript stays at0.28.20 because the actual engine parser still uses it.
No compiler, parser, runtime, test or source behavior is removed.

The original and replacement index.js files have the same13572386bytes.
Their SHA256 is08e348487a67b24351d5ff81ae707e051b5d213bd359d84ad90c789f3793001a.
The replacement declaration SHA256 is4070415465f0d5b83fbca3609a9b99b110f34d1daabd1b9eedd6411130490422.
The real public assemblyscript/asc compileString API compiles the same affine program.
Both old and new compilers emit exactly the same60WASM bytes.
The WASM SHA256 is40b0382b3e0dd14745445507aab77eb5305ff0254c4ad4fd375eaf850cffb4d6.
The instantiated result affine(5) stays22.
A direct Buffer.equals comparison checks the complete WASM, without normalization.
The real codeLines parser still counts the AssemblyScript input as one line.
The existing ratchet-paths file passes its three original cases.
The lift-pending shard-platform CLI test was not executed and is not claimed.

Fresh frozen baseline node_modules/.pnpm is371444KiB.
Fresh frozen candidate node_modules/.pnpm is289076KiB.
The observed saving is82368KiB, or80.4375MiB, in this engine clone.
A normal update left orphaned old Binaryen files; pnpm prune did not remove them.
Only this own clone literal node_modules path was deleted before the fresh candidate install.
No shared store, live checkout, peer output or coordinator scratch was deleted.
Both final footprints use frozen installs, not a misleading leftover virtual store.

The exact npm dist integrity matches the lock entry.
No bin consumer was found in engine source or scripts at the initial probe.
Recheck that inventory after rebasing the source to current main.
The first supplemental probe used a CommonJS resolver for an ESM-only AssemblyScript export.
That probe error was corrected; the actual ESM API and byte comparisons pass.
It was not a dependency failure or a changed compiler result.

This commit records source overrides and lock resolution, with normal commit hooks.
Rebase before the fresh official renderer/validation stamps and publication.
A one-shot J206 review and complete unmodified normal push gate still precede publication.
NM6 remains open until sharddev and every shard root also pin the intended two releases and pass their real proofs.
No test, budget, hook, CI cap, quarantine record or deadline changes here.
The J20006:00UTC wake90531 remains alive while this independent dependency work proceeds.

## Current main and bounded checks

The source commit is rebased onto exact green a9d2e4f.
Frozen installation reports the candidate lock up to date.
The current API/compiler result is recorded at2026-11-10T03:07:58Z.
The complete original WASM still matches byte for byte.
No Binaryen bin or wasm tool consumer appears in src or scripts.
The named ratchet-paths file passes3of3 in4.64seconds after this rebase.
It is invoked through the normal named-file vitest-tmp command.
The full-test wrapper refused a manual invocation; no override was used.
The earlier source commit wrapper logged8053ms, above its5s total target.
That commit returned success; this journal does not call it a budget pass.
Both official revision writers are freshly run twice and deterministic.
Only the two generated revision JSON files accompany this evidence update.
The official J206 one-shot review covers the entire source-plus-stamp delta.
Normal publication alone authorizes the full WS_FULL_SUITE=1 gate.
No manual broad test suite, bypass or inherited global hold is introduced.
FL17 is now public a9d2e4f and exact CI/Ring1 green, separate from NM6.
Seven other quarantine entries retain their original policy values.
The06:00UTC J200 wake remains alive; this dependency work changes no deadline.

## One-shot review receipt

Official J206 review has no MUST-FIX.
Review path: pinefix2-nm6-engine-NM6-engine-20261110T032523Z-72888.md.
It independently confirms override, lock, installed resolution and stamp scope.
Its SHOULD-FIX is missing original declaration hash in the baseline JSON.
The exact original public npm tarball is now read without executing package scripts.
Its entire index hash matches the recorded old baseline.
Its entire declaration hash matches the replacement4070415465f0d5b83fbca3609a9b99b110f34d1daabd1b9eedd6411130490422.
The baseline JSON explicitly labels this later original-package recheck.
No later recheck is represented as an earlier captured measurement.
The complete tarball integrity and byte hashes remain in own NM6 evidence.
No second review round or source/test change is needed for this evidence correction.

## Q130 install forward

Q130 fails before its hook at tools:install.
Actual npr error is package.json differs from binDependencies.
The root override is copied into the frozen native-tool manifest.
The same exact failure reproduces in this own clone.
Official npr install refreshes only .bin-deps/package.json and its lock.
It adds the identical scoped override; all three tool versions stay pinned.
The original frozen tools:install command then succeeds without an override.
No full-hook verdict is claimed for failedQ130 and no duplicate retry is enqueued.
Urgent Nalati fuzz and tape-worker investigation now takes priority.

## Fresh combined publication

The publication view starts on exact green8d134e2 and includes tape7c00ead.
Own NM6 source is carried as e7471c1; no peer source is replaced.
Only own reviewed journal and official generated native-tool metadata deltas follow.
Fresh frozen pnpm install succeeds401ms and original frozen tools install succeeds.
Official renderer and validation writers are rerun in separate processes and stable.
This replaces obsolete standalone Q130 stamps with current combined inputs.
No Q130 duplicate is enqueued; the next immutable full gate owns this source candidate.
