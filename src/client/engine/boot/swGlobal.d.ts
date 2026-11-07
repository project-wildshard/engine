import type { WsSw } from './sw';

// The page's service-worker handle (src/client/engine/boot/sw.ts sets it). An ambient file, so every layer's TypeScript
// project sees it (AG4), not only the files that import sw.ts.
declare global {
  interface Window {
    __ws_sw?: WsSw;
  }
}
