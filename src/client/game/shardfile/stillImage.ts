import { parseStillImage } from '@wildshard/format/stillImage';

/** Resolve verified immutable bytes to an owner-revoked, MIME-sniffed inert URL; never accept an authored URL or SVG. */
export function stillImageObjectUrl(bytes: Uint8Array, owner: { readonly disposed: boolean; readonly disposing?: boolean; onDispose: (fn: () => void) => void }): string {
  if (owner.disposed || owner.disposing) throw new Error('Image owner retired');
  const { mime } = parseStillImage(bytes);
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mime }));
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    URL.revokeObjectURL(url);
  };
  try {
    owner.onDispose(release);
    if (released || owner.disposed || owner.disposing) throw new Error('Image owner retired');
  } catch (error) { release(); throw error; }
  return url;
}
