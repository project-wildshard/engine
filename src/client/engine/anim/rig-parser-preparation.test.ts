// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { DefaultLoadingManager } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { prepareRigLoader, loadRigFile } from './rig';
import {readModuleGroups} from '../boot/download';
import { loadGLTF } from '../core/assets';

let inventory: HTMLScriptElement | undefined;
afterEach(() => { inventory?.remove(); inventory = undefined; vi.restoreAllMocks(); });

function bank(groups: unknown): void {
  inventory = document.createElement('script'); inventory.id = 'boot-module-files';
  inventory.textContent = JSON.stringify({optional:{files:[['/assets/parser.js',17]],groups}});
  document.body.append(inventory);
}

const empty = JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]});

test('missing parser admission refuses before importing its code or publishing bytes', () => {
  bank({'models.gltf':[1]});
  expect(() => prepareRigLoader()).toThrow('Missing selected client module file');
});

test('parser requests check read-only compiler facts before awaiting the original module', async () => {
  bank({'models.gltf':[0]});
  try {
    const requested = prepareRigLoader();
    expect(prepareRigLoader()).toBe(requested);
    expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js', 17]]);
    const first = await requested, second = await prepareRigLoader();
    expect(first).toBe(second); // Native module identity; no replacement loader or memo book.
    expect(first.createRigLoader()).not.toBe(first.createRigLoader());
    expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js', 17]]);
  } finally { inventory?.remove(); }
});

test('a warm parser still checks each replacement module bank', async () => {
  bank({'models.gltf':[0]});
  const module = await prepareRigLoader();
  try {
    expect(await prepareRigLoader()).toBe(module);
    expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js', 17]]);
    inventory?.remove(); inventory = undefined;
    bank({'models.gltf':[1]});
    expect(() => prepareRigLoader()).toThrow('Missing selected client module file');
    expect(() => readModuleGroups(['models.gltf'])).toThrow('Missing selected client module file');
  } finally { inventory?.remove(); }
});

test('concurrent file reads keep the original shared loader and isolated alias manager', async () => {
  const file = await new GLTFLoader().parseAsync(empty, ''), receivers: GLTFLoader[] = [];
  const releases: (() => void)[] = [];
  let blocked = true;
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(function readOriginalFile(this: GLTFLoader) {
    receivers.push(this);
    return blocked ? new Promise(resolve => { releases.push(() => { resolve(file); }); }) : Promise.resolve(file);
  });
  const pending = Promise.all([loadRigFile('/one.glb'),loadRigFile('/two.glb'),loadRigFile('/three.glb')]);
  try { await expect.poll(() => receivers.length).toBe(3); }
  finally { blocked = false; for (const release of releases) release(); }
  const reads = await pending;
  expect(reads).toEqual([file,file,file]);
  expect(new Set(receivers).size).toBe(1);
  expect(receivers[0]?.manager).toBe(DefaultLoadingManager);
  await loadRigFile('/alias.glb',{'/image.png':'/replacement.png'});
  expect(receivers[3]).not.toBe(receivers[0]);
  expect(receivers[3]?.manager).not.toBe(DefaultLoadingManager);
});

test('the asset owner retains one original loader across concurrent first reads', async () => {
  const file = await new GLTFLoader().parseAsync(empty, ''), assets: GLTFLoader[] = [];
  vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation(function readOriginalAsset(this: GLTFLoader, _url, onLoad) { assets.push(this); onLoad(file); return undefined; });
  expect(await Promise.all([loadGLTF('first'),loadGLTF('second')])).toEqual([file,file]);
  expect(new Set(assets).size).toBe(1);

});
