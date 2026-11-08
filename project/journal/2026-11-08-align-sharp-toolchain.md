# Match the author's image toolchain

NM7 aligns engine's Sharp with the SDK's transitive image decoder.
Both direct pins now use Sharp 0.35.5.
The SDK previously loaded two versions of native libvips.
That produced an actual duplicate native Objective-C class warning.
One shared pin removes that second installed implementation.

Engine keeps Sharp as its existing build-library dependency.
No runtime image recipe, shader, model or layout is edited.
The normal pnpm install and prune update the lockfile.
The generated validator stamp follows the actual dependency change.
It is not replaced with an earlier receipt to hide a new toolchain.

Engine's four atlas cases pass in a 1.01-second file run.
They bake real maps, verify exact source hashes and inspect pixels.
Missing and corrupt maps still fail their real admission path.
The emitted atlas URL continues to name its actual image bytes.

The SDK's public image and author-input proofs also pass.
Their eleven real outside-author cases run in 31.17 seconds total.
Each individual case remains below ten seconds.
The whole SDK check passes 770 author plus 34 kit cases.
SDK's exact native artifact identity required an adapter update.
That matching SDK change preserves strict binding and byte checks.

pnpm why shows one libvips 1.3.4 in engine.
The SDK likewise shows only that version after a normal prune.
Engine's store is 345168 KiB, up 2564 KiB for newer libvips.
Deduplicating the SDK's old copy is the saving, not that engine delta.
The npr compiler and formatter locks stay unchanged.
No assertion, case deadline or hook is removed for this upgrade.
Engine publication remains with the release lane through its tag.
