# CI's dedicated build starts from installed inputs

Reproduced the old builder failing in a fresh checkout with ENOENT for
public/assets/physics/rapier.wasm. That ignored web-build output happened
to exist in the port's development clone, but a server-only runner has
never generated it. Resolve the identical binary from the pinned Rapier
package directly, as the web asset copier does. The clean checkout then
builds main.mjs, cellWorker.mjs, migrations and the matching binary.

This keeps the server CI independent of a web build, generated assets or
the local pins cache. The normal pre-push still runs the whole suite.
