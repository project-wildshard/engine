import { contentURL } from '@wildshard/engine/boot/contentBase';

declare const __TITLE_ASSET_URLS__: Readonly<Record<string, string>>;

/** Use content-named art in the app; unbundled author tools keep logical source paths. PAGE-SIZE PZ13: title art is content,
 *  so a page with a content base reads it there. */
export function titleAssetURL(source: string): string {
  return contentURL(typeof __TITLE_ASSET_URLS__ === 'object' ? __TITLE_ASSET_URLS__[source] ?? source : source);
}
