# Declare the three installed declaration peers

GVS-PLAN G3 replaces the checkout-only TypeScript paths workaround.
The earlier NM9 trial mapped three to the checkout @types/three package.
That made engine typechecking pass but did not transfer to consumers.
The runtime packages actually describe a peer relation to Three types.
This is declaration metadata, not renderer or Three source work.

The current global-store installation reproduces91 layered type errors.
The paths workaround was removed before running that exact command.
Postprocessing materials lose inherited ShaderMaterial members.
N8ao inherits the same broken declaration context.
Navcat loses its inferred Three types too.
The baseline errors are retained in owned scratch.

Add optional @types/three peers through pnpm packageExtensions.
The three targets are postprocessing, n8ao and navcat only.
Each extension has the same wildcard peer range as the plan.
The peer is optional so runtime-only installations need no type package.
The root already pins its exact @types/three version.
No package version, integrity or runtime graphics source is changed.

The normal pnpm lockfile writer generates the checksum and contexts.
Only the three selected peer snapshots and references change.
The tracked global virtual store default remains false.
A normal frozen install explicitly uses the private global store.
That install succeeds with the generated lock and extensions.
The exact same complete layered TypeScript command exits0.
No tsconfig paths fallback remains in the resulting source.

The separate G1/G2 permission closure fix is not a types workaround.
G4 source export support remains its earlier separate local commit.
Neither a full engine check nor hosted success is claimed here yet.
The one-shot review and normal source publication follow.
No quarantine, timeout, CPU, CI cap or admission policy changes.

J206 one-shot G3 review returns GO with no MUST/SHOULD.
The review verifies the exact optional peer and lock scope.
All196 package resolution/integrity entries match the prior lock.
The final full-layer type build exits0 under the real external store.
Only the three selected peer contexts and their references change.
