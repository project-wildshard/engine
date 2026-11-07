/** Describe a transport's purpose without exposing content addresses as work. */
export function productResourceRole(input: string, base = 'https://product.invalid/'): string {
  let path: string;
  try {path = new URL(input, base).pathname;}
  catch {return 'Product data';} // A label never replaces the transport's own refusal.
  if (path.endsWith('/shard.json')) return 'Product descriptor';
  if (path.includes('/sections/')) return 'Product data section';
  if (path.includes('/packs/')) return 'Product pack';
  if (path.endsWith('.glb')) return 'Model data';
  if (/\.(?:ktx2|png|jpe?g|webp|avif)$/u.test(path)) return 'Texture data';
  if (/\.(?:wav|aac|m4a|ogg|mp3)$/u.test(path)) return 'Audio data';
  if (path.endsWith('.wasm')) return 'Program data';
  return 'Product data';
}
