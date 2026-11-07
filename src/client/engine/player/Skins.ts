import * as THREE from 'three';
import type { WeaponId } from '../../../shared/engine/combat/Equipment';
import type { SkyRig as Sky } from '../world/skyRig';
import { fixIBL, isMesh, VIEWMODEL_GROUP } from '../combat/view/ranged';
import { copyShaderPatches } from '../render/shaderPatches';


/** Material cosmetics supplied by the host's registered rows. */
export type WeaponKind = WeaponId;
export type SkinId = string;

/** `plain` drops the base texture and the vertex-colour wear so `color` / `roughness` / `metalness` are exact (the normal map stays
 *  for relief) — that is a define change, so it costs one program per (weapon material, skin). */
interface MatOverride { color?: number; emissive?: number; emissiveIntensity?: number; roughness?: number; metalness?: number; envMapIntensity?: number; plain?: boolean }
/** Reversible material identity and numeric overrides; no weapon metadata or shard callbacks. */
export interface MaterialSkinDef {
  id: SkinId;
  mats: Readonly<Record<string, MatOverride>>;
  material?: 'standard' | 'lambert';
}
export interface SkinDef extends MaterialSkinDef {
  weapon: WeaponKind;
  /** display name ("Ghost Stag") */
  name: string;
  /** one line for the pickup toast */
  blurb: string;
  /** which legendary kill drops it (none = in the code only) */
  dropsFrom?: { kind: string; variant: string };
  /** extra geometry, built once per root with the skin's cloned materials at hand */
  extras?: (root: THREE.Object3D, mat: (name: string) => THREE.Material | undefined) => THREE.Object3D[];
}

// ───────────────────────────── applying ─────────────────────────────

interface SkinState { id: SkinId; originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>; clones: Map<THREE.Material, THREE.Material>; extras: THREE.Object3D[] }
const STATE = new WeakMap<THREE.Object3D, SkinState>();

let white: THREE.DataTexture | undefined;
function whiteTex() {
  if (!white) { white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.colorSpace = THREE.SRGBColorSpace; white.needsUpdate = true; }
  return white;
}

function cloneWith(orig: THREE.Material, o: MatOverride, group: string, sky?: Sky): THREE.Material {
  const m = orig.clone();
  if (!(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshLambertMaterial)) throw new Error('Material skins require a lit material');
  m.name = orig.name;
  if (o.plain) { m.map = whiteTex(); if(m instanceof THREE.MeshStandardMaterial)m.aoMap = m.roughnessMap = m.metalnessMap = whiteTex(); m.vertexColors = false; }
  if (o.color !== undefined) m.color.setHex(o.color);
  if (o.emissive !== undefined) m.emissive.setHex(o.emissive);
  if (o.emissiveIntensity !== undefined) m.emissiveIntensity = o.emissiveIntensity;
  if(m instanceof THREE.MeshStandardMaterial){
    if (o.roughness !== undefined) m.roughness = o.roughness;
    if (o.metalness !== undefined) m.metalness = o.metalness;
    if (o.envMapIntensity !== undefined) m.envMapIntensity = o.envMapIntensity;
  }
  // clone() drops the instance hooks: the dfg fix and the sky / CSM setup must be re-applied (else metals go black)
  if(sky===undefined)copyShaderPatches(orig,m);
  else {fixIBL(m, group);sky.setupMaterial(m);}
  return m;
}

function applySkinState(root: THREE.Object3D, skin: MaterialSkinDef, sky?: Sky): SkinState | null {
  const prev = STATE.get(root);
  if (prev?.id === skin.id) return null;
  if (prev) clearSkin(root);
  const state: SkinState = { id: skin.id, originals: new Map(), clones: new Map(), extras: [] };
  const group = VIEWMODEL_GROUP;
  const selected=(mat:THREE.Material):boolean=>skin.mats[mat.name]!==undefined&&(skin.material===undefined
    ||skin.material==='standard'&&mat instanceof THREE.MeshStandardMaterial||skin.material==='lambert'&&mat instanceof THREE.MeshLambertMaterial);
  const clone = (mat: THREE.Material) => {
    const o = skin.mats[mat.name]; if (o===undefined||!selected(mat)) return mat;
    let c = state.clones.get(mat);
    if (!c) { c = cloneWith(mat, o, group, sky); state.clones.set(mat, c); }
    return c;
  };
  root.traverse((mesh) => {
    if (!isMesh(mesh)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.some(selected)) return;
    state.originals.set(mesh, mesh.material);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
  });
  STATE.set(root, state);
  return state;
}

/** Clone row-selected lit materials while retaining their exact shader patches; clearSkin restores and disposes them. */
export function applyMaterialSkin(root: THREE.Object3D, skin: MaterialSkinDef): void { applySkinState(root,skin); }

/** Restyle `root` (a viewmodel or a display copy) as `skin`; a different skin on the same root swaps cleanly. */
export function applySkin(root: THREE.Object3D, skin: SkinDef, sky: Sky): void {
  const state=applySkinState(root,skin,sky);if(state===null)return;
  if (skin.extras) {
    state.extras = skin.extras(root, (n) => [...state.clones.values()].find(material=>material.name===n));
    // extras inherit the root's render flags (a viewmodel draws in the transparent queue after a depth clear)
    const sample = [...state.originals.keys()][0];
    for (const e of state.extras) e.traverse((m) => { if (isMesh(m) && sample) { m.renderOrder = sample.renderOrder; m.frustumCulled = sample.frustumCulled; m.castShadow = sample.castShadow; m.receiveShadow = sample.receiveShadow; } });
  }
}

/** back to the plain weapon */
export function clearSkin(root: THREE.Object3D): void {
  const s = STATE.get(root); if (!s) return;
  for (const [mesh, mat] of s.originals) mesh.material = mat;
  for (const e of s.extras) { e.removeFromParent(); e.traverse((m) => { if (isMesh(m)) m.geometry.dispose(); }); }
  for (const c of s.clones.values()) c.dispose();
  STATE.delete(root);
}
