// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { LoadProgress } from '../ui/loadProgress';
import { ModelExplorer } from './ModelExplorer';
import type { CatalogEntry } from './catalog';

test('a completed async card publishes the actual composer canvas beside hidden progress', async () => {
  const grid = document.createElement('div');
  grid.innerHTML = '<button class="ws-x-model" data-id="fixture/house"><span class="ws-x-model-thumb"></span><small></small></button>';
  const slot = grid.querySelector<HTMLElement>('.ws-x-model-thumb'); if (slot === null) throw new Error('Missing card');
  const progress = new LoadProgress(slot);
  let complete = (): void => { throw new Error('Missing preparation'); };
  const preparation = new Promise<void>(resolve => { complete = resolve; });
  const pending = progress.watch('House', [preparation]);
  expect(progress.element.hidden).toBe(false);
  complete(); await pending;
  expect(progress.element.hidden).toBe(true); expect(slot.firstChild).toBe(progress.element);
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const model = new Group(); model.add(mesh); model.updateMatrixWorld(true);
  const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
  const drawImage = vi.fn<(image: CanvasImageSource, ...coordinates: number[]) => void>(), render = vi.fn<() => void>();
  const context = legacyDouble<CanvasRenderingContext2D>({ drawImage, fillRect: vi.fn<CanvasRenderingContext2D['fillRect']>() });
  const drawing = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const entry: CatalogEntry = { id: 'fixture/house', name: 'House', category: 'buildings', file: 'fixture', live: false,
    object: () => model, copies: 1, drawnAs: 'single', buildMs: 0, pipeline: ['code'] };
  // Exercise the real rendering/publication method without constructing the unrelated studio controls.
  const draw: unknown = Reflect.get(ModelExplorer.prototype, 'drawThumbnail');
  if (typeof draw !== 'function') throw new Error('Missing thumbnail renderer');
  const receiver = { world: { game: { camera: new PerspectiveCamera(50, 0.75), canvas, shardFrame: vi.fn(), composer: { render } } },
    studio: new Group(), fresh: new Set(), scratch: new PerspectiveCamera(), target: new Vector3(), pitch: 0.3, yaw: 0.5,
    isolate: vi.fn(), unisolate: vi.fn(), frameModel: vi.fn(), thumbs: new Map(), grid };
  try {
    Reflect.apply(draw, receiver, [entry]);
    expect(render).toHaveBeenCalledOnce(); expect(drawImage).toHaveBeenCalledOnce();
    expect(drawImage.mock.calls[0]?.[0]).toBe(canvas);
    const thumbnail = slot.querySelector('canvas'); expect(thumbnail).not.toBeNull();
    expect(thumbnail?.width).toBe(240); expect(thumbnail?.height).toBe(180);
    progress.dispose(); expect(slot.querySelector('canvas')).toBe(thumbnail);
    Reflect.apply(draw, receiver, [entry]); expect(slot.querySelectorAll('canvas')).toHaveLength(1);
  } finally { drawing.mockRestore(); progress.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
});
