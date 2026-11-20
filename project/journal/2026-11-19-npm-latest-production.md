2026-11-19 — npm latest follows the signed production build

J475 let v0.1.53 publish to npm next on exact release CI. The version tag
could not move an npm package that already existed. After the coordinator
ordered prod and latest for v0.1.53, the npm workflow gained a separate
manual promotion of the existing package.

It checks out the published tag and reads the production page and signed
rooms publication. The tag, build, version and save epoch must agree
before npm can move latest. npm authenticates with the same GitHub OIDC
publisher and needs npm's dist-tag permission for that workflow.
