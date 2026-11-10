# NM9: keep frozen exports compatible with a registered global store

J199 authorizes a private global-virtual-store trial, not a live default flip.
This full private main clone initially installed frozen in2.5s.
Its node_modules occupied172KiB; the shared store is not counted as saved.
The tracked package, lock, workspace and npmrc bytes were unchanged.
The existing web build passed, while full check waited5minutes for its lease.
That admission timeout was not a GVS test failure.

A real cold git archive then failed in linkNodeModules.
The installed format package was in pnpm's external global virtual store.
The old root-scoped linker refused every outside target.
Reusing that partial failed output could take a different code branch.
Every cold-export proof therefore starts with a new owned directory.

The source now accepts an external package only through installation metadata.
The canonical target must remain inside the registered virtual-store root.
Its actual package manifest must name the requested scoped package.
Unknown outside source aliases still refuse, as do symlink escapes.
Missing or corrupt metadata grants no authority to lend outside source.
The ordinary inside-repo links retain their previous frozen-source mapping.
No dependency version, source pin, override or default setting changes.

Metadata itself may be linked into an exported tree.
Its relative store path belongs to the original metadata file's directory.
Resolve that file before resolving its store, so nested exports stay valid.
A nested export still consumes its own engine source and the same installed format.

The existing linker file has three preserved cases and one new outer-edge case.
The old source passes three and fails the new cold-export case in265ms.
Node's actual module loader reads distinct frozen and dirty source markers.
The supported source passes all four in127ms, with nested source isolation.
The same case refuses outside aliases, store symlink escapes, corrupt metadata,
and a store package whose actual identity differs from the requested one.
No fake module loader, emitted gameplay event or implementation counter is used.

This is local preparation; the complete NM9 trial is still open.
Full check, build, e2e and Ring1all must prove the actual GVS layout persists.
The temporary private trial setting must not enter a source publication.
The committed workspace default remains off until the authorized trial is green.
No live alias/mode change, deployment, quarantine or deadline edit is included.

The GVS layout also exposed a real declaration-resolution failure.
Postprocessing/glTF declarations no longer found the checkout's Three types
from their physical global-store ancestry; the existing source reported
missing inherited material/texture properties and an implicit-any callback.
The same app compiler command with preserveSymlinks passes without a source edit.
A global preserveSymlinks experiment fixes that app check but is rejected:
it loses Vitest assertion augmentation and format's transitive meshoptimizer.
The common default is restored. Explicit typeRoots still fails the full graph.
A compiler-only exact three-to-existing-@types/three mapping passes the full
layered typecheck, preserving physical transitive/runtime resolution.
No bundler plugin consumes tsconfig paths in this source tree.
Full runtime and browser trial checks remain required before promotion.
Node/browser runtime resolution is not changed.
No rendering source, Three API, shader or layout adjustment is included.
The private trial uses an uncommitted workspace setting because pnpm10.34.9
prefers that workspace value over npm_config environment overrides.
That temporary true flag is excluded from any published source commit.

One-shot J206 review found three MUST items, all fixed before publication.
A rejected cold export leaves a partial node_modules directory. Old real code
refuses its first call and accepts its second unauthorized outside source;
the fixed implementation refuses both calls in the retained regression.
Canonical scope classification now applies on cold, reused and package-local
links, so an inside-repo alias cannot disguise an outside checkout.
The export root's self package also remains frozen on a repeated call.
Actual pinned pnpm metadata is read in the loader fixture, with only its store
location substituted. JSON and ordinary top-level plain/quoted YAML paths work;
ambiguous/tagged store scalars remain rejected. No dependency/parser is added.
A shared transitive provider has the same actual Node object through frozen
engine, installed format and nested export. All four outer-edge cases pass.
Correct repository typed lint and full layered types pass after these fixes.
The already completed Chromium e2e passes with both required keychain flags.
The full trial check was stopped only while unstarted in its admission queue
so it could include the review fixes; its successor is normally queued.
The build passes. Fullcheck and Ring1all remain pending, not inferred green.
The private workspace flag has now been restored byte-for-byte to defaultfalse.
The physical installed layout remains the actual registered global store;
restoring source configuration does not relocate the installed dependency tree.
