# KTX2 input for the material loader lifetime proof

SF16 routes textures by their bytes. The lifetime tests stub the KTX2
transcoder, so their inputs now carry the KTX2 identifier. Hosted run
45924093166 sent the old one-byte fixtures to the image decoder instead.
The cancellation test waits until the mocked transcode starts because
SF16 can resolve cooked texture URLs asynchronously before starting it.
The six proofs check disposal, refusal, cancellation, borrowed texture
ownership and garbage collection.
