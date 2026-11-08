# E7 channel publication boundary

The prepared E7 port already reads signed release files. CI now has a
strict signer for the complete C21–C31 publication: full build SHA,
epoch at least one, pinned shards, immutable archive digest and public
socket. The private key is supplied later through E7_RELEASE_SIGNING_KEY;
this lane generated only ephemeral proof keys in memory.

Serials belong to each channel object. Authenticate the old file before
using its serial, then conditionally replace its ETag. A loopback S3
integration proof uses real SDK requests and real git ancestry to force
a 412 race, retry it, and refuse a late older green build. Both existing
engine verifiers read the new signer's staging and production output.

The source scripts retain the surrounding checked-JSDoc mjs tooling
convention, with declarations for the TypeScript test boundary. No hook
or test scheduling changes were needed. No publishing command ran.

After the public native-proof fixes claimed A2, the held E7 receipt
claims A3 and this new CI job now claims A5. Public engine-test A4
is preserved unchanged on the 9059d6b rebase.
