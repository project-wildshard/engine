/** A file whose NAME already carries its content hash: the boot packs (`/assets/packs/<slug>.<tier>-<hash8>.bin`), the audio
 *  (`<name>-<sha1[:8]>.m4a`), `<name>-<hash8>.<ext>` and full SHA-256 basenames (`<sha256>.<ext>`). Such a URL is
 *  content-addressed as it stands: it gets no `?v=`. The same rule lives in `pwa/sw.js` (CONTENT_NAMED_RE): keep them in step. */
// oxlint-disable-next-line typescript/no-inferrable-types -- isolatedDeclarations wants the type written.
export const CONTENT_NAMED_RE: RegExp = /^\/assets\/packs\/|-(?:[0-9a-f]{8}|[0-9a-f]{16})\.[a-z0-9]+$|\/[0-9a-f]{64}\.[a-z0-9]+$/;
export const contentNamed = (path: string): boolean => CONTENT_NAMED_RE.test(path);
