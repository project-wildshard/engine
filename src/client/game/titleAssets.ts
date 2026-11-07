declare const __TITLE_ASSET_URLS__: Readonly<Record<string, string>>;

/** Use content-named art in the app; unbundled author tools keep logical source paths. */
export function titleAssetURL(source: string): string {
  return typeof __TITLE_ASSET_URLS__ === 'object' ? __TITLE_ASSET_URLS__[source] ?? source : source;
}
