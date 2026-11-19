/** Whether this document was built for the solo Explore app. A URL cannot select the channel. */
export function exploreChannel(): boolean {
  return (globalThis as { __WS_EXPLORE__?: unknown }).__WS_EXPLORE__ === true;
}
