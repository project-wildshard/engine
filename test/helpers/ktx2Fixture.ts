// SF16: the page decodes a texture by its bytes' magic (`textureKind`): a KTX2 identifier transcodes, a PNG or JPEG
// decodes as an image, anything else is refused by name. A test's stand-in KTX2 must therefore start with the identifier;
// this helper is that stand-in, so a fixture never drifts back to made-up bytes.
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** A KTX2 stand-in: the 12-byte identifier, then `tag` bytes that tell fixtures apart. */
export const ktx2Fixture = (...tag: readonly number[]): Uint8Array => new Uint8Array([...KTX2_IDENTIFIER, ...tag]);
