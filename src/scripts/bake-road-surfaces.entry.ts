import {junctionTextureSteps, roadTextureSteps} from '../client/game/grid/roadSurfaceMaps';

async function paint(kind: 'asphalt' | 'junction'): Promise<{kind: string; width: number; height: number; png: number[]}> {
  const steps = kind === 'asphalt' ? roadTextureSteps() : junctionTextureSteps();
  let next = steps.next();
  while (next.done !== true) next = steps.next();
  const texture = next.value, image: unknown = texture.image;
  if (!(image instanceof HTMLCanvasElement)) throw new Error('Road painter must produce a canvas');
  // Compressed textures upload without WebGL flipY; preserve the canvas texture sampler orientation.
  const output = document.createElement('canvas'); output.width = image.width; output.height = image.height;
  const context = output.getContext('2d'); if (context === null) throw new Error('No road bake context');
  context.translate(0, image.height); context.scale(1, -1); context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => { output.toBlob(value => { if (value === null) reject(new Error('Road PNG encode failed')); else resolve(value); }, 'image/png'); });
  const result = {kind, width: image.width, height: image.height, png: Array.from(new Uint8Array(await blob.arrayBuffer()))};
  texture.dispose();
  return result;
}
Object.defineProperty(globalThis, '__bakeRoadSurfaces', {value: () => Promise.all([paint('asphalt'), paint('junction')])});
