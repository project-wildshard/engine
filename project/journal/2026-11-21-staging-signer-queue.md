# Staging signer queue

The v0.1.64 staging signer sat behind the client archive build in
44918657102 after its server bundle and both client archives were
already on the immutable release. We verified both digests and
cancelled the redundant build to let signer 44920706957 run.

FS28 queues signing per build and channel and queues client archives
per release tag. The signer can take its turn as soon as the previous
publish job finishes. The archive's queue still protects an upload
shared by both workflow entry points.
