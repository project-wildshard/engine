# Keep signed release readers forward compatible

On RL10, production v0.1.97 rejected the `shardVersion` field in signed
v0.1.100 serial 56. Its bundle pull had already verified and unpacked the
new build. With zero players, the allowlisted restart ran the startup
pull and activated the new build at release serial 56 and placement 7.

QA58 sends signed additive fields through the room and WebCrypto
readers and still requires valid known fields. The recovery stays in
the release guide alongside the alias-last gate.
