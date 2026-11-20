2026-11-19 — J475 publishes two engine versions

The coordinator put this part of FS28 before v0.1.54 after npm refused
the trusted publisher's dist-tag write. Early publishing builds the
release commit and stamps only its private npm archive with
`<version>-next.<short sha>`. The archive retains the full build SHA,
and the runtime still uses the stamped release version.

The train dispatches the final npm publish after production readback.
The workflow checks the released tag against the public page and signed
rooms, then publishes the original version with the latest tag. Both
publications use the existing trusted publisher and its publish grant.
Pushing a git version tag by itself starts no npm publish.
