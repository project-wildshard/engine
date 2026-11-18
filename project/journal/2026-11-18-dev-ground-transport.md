# Watch ground over the Node dev channel

The sharddev watch page sent a `Float32Array` through JSON. The game server
received an object with numeric keys and refused the edit, so the page and
simulation could disagree about the ground.

Send an array on HTTP and validate its count and numbers before converting
it back to Float32. The worker port keeps its structured-clone message.
A loopback test exercises the actual client and server route together.
