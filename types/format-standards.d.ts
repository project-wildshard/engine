/** Portable standard globals used by pure format admission in both Node and browsers.
 * Keep the format project free of DOM, Node packages and renderer declarations. */
/** UTF-8 encoding result used by bounded format-size checks. */
export interface FormatTextEncoder {
  encode: (input?: string) => Uint8Array<ArrayBuffer>;
}
declare global {
  class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
    decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string;
  }
  namespace WebAssembly {
    function validate(bytes: Uint8Array): boolean;
  }
  function structuredClone<T>(value: T): T;
  class TextEncoder implements FormatTextEncoder {
    encode(input?: string): Uint8Array<ArrayBuffer>;
  }
}
