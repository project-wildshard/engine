# CI's dedicated build starts from installed inputs

Reproduced the old builder failing in a fresh checkout with ENOENT for
public/assets/physics/rapier.wasm. That ignored web-build output happened
to exist in the port's development clone, but a server-only runner has
never generated it. Resolve the identical binary from the pinned Rapier
package directly, as the web asset copier does. The clean checkout then
builds main.mjs, cellWorker.mjs, migrations and the matching binary.

This keeps the server CI independent of a web build, generated assets or
the local pins cache. The normal pre-push still runs the whole suite.

Built and archived the corrected target, then ran the production CLI's
configuration-only preflight with an ephemeral key and fake R2 settings.
Empty shard configuration admitted the default first-sitting pins. A
loopback server served that archive and a CI-signed release file to the
real pull.mjs: it verified, unpacked, retained the signed file and moved
the test-owned current link. Requests used releases/production.json and
v1.2.3/e7ci-server.tar.gz, proving C25's relative tag path at the boundary.
Nothing contacted GitHub publishing, R2 or the VPS.
