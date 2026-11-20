# Driftwood time to play on the iPhone 13 (mini-dw-boot)

- link-bench (DW6): cools the phone to 35 C outside the phone locks, logs lockState around every devicectl
  launch, asks for the wake lock per document through emulateUserGesture, and records temperature. --profile-op
  samples ScriptProfiler while one boot operation is active; --shot takes a screenshot after control (J430).
- First pairs: load (ENTER to loader done) is the biggest stage cold and warm on public main and staging
  v0.1.53; its biggest step is Home region, 3.3 to 5.6 s. In it the shader source book's JS SHA-256 was 183 of
  2050 profiler samples.
- DW7: the shader source book's key (shaderSourceCache sourceKey) is a 64-bit multiply-xor over the UTF-16
  units plus the length, not a JS SHA-256 of the UTF-8 bytes: about 4x cheaper in V8, and the SHA-256 was 183 of
  2050 profiler samples in Driftwood's Home region step on the iPhone 13. The book is per build and zone, so no
  key crosses builds. Blind J430 board on the phone: same look.
