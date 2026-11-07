import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SkyBackdropPost, SkyBackdropTargets } from '@wildshard/engine/render/look';
import { driveDayAir, type DayAirRow } from './daySky';

const c = (v: number): THREE.Color => new THREE.Color(v, v, v);
const u = <T>(value: T): { value: T } => ({ value });

function targets(underwater: boolean): SkyBackdropTargets {
  return {
    sunDir: new THREE.Vector3(), sunColor: new THREE.Color(), lights: [], lightDirection: new THREE.Vector3(),
    hemi: new THREE.HemisphereLight(), fog: new THREE.Fog(0x000000),
    fogU: { fogSunDir: u(new THREE.Vector3()), fogSunColor: u(new THREE.Color()), fogDistDensity: u(0), fogHeightDensity: u(0) },
    underwater: () => underwater,
    disc: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), halo: new THREE.Sprite(new THREE.SpriteMaterial()),
    cloud: { uSunDir: u(new THREE.Vector3()), uSunColor: u(new THREE.Color()), uCloudLit: u(new THREE.Color()), uCloudAlpha: u(0) },
    far: { uHazeCol: u(new THREE.Color()), uSeaSky: u(new THREE.Color()), uSeaSun: u(new THREE.Color()), uSeaSunDir: u(new THREE.Vector3()) },
    planet: { uSunDir: u(new THREE.Vector3()), uHaze: u(new THREE.Color()), uCrisp: u(0) },
    shadowBusy: () => false,
  };
}

const row: DayAirRow = {
  env: 0.7, fogSun: c(0.2), fogDist: 0.003, fogHeight: 0.002, disc: c(1), halo: c(0.5), haloO: 0.8,
  cloudSun: c(0.3), cloudLit: c(0.4), cloudA: 0.6, far: c(0.5), light: c(1), volColor: c(1), vol: 0.9, rays: 0.5, sat: 0.1,
};

describe('driveDayAir', () => {
  it('writes the hour\'s air into the backdrop targets and the post chain', () => {
    const T = targets(false), scene = { environmentIntensity: 0 }, body = new THREE.Vector3(0, 1, 0);
    let strength = 0;
    const post: SkyBackdropPost = { vol: { setSun: () => undefined, setFogColor: () => undefined, setStrength: (s) => { strength = s; } }, rays: { blendMode: { opacity: u(0) } }, hueSat: { saturation: 0 } };
    driveDayAir(T, post, scene, row, { fog: c(0.6), body, cloudBody: body, fade: 0.5, above: 0.5, discScale: 0.6, haloK: 0.5 });
    expect(scene.environmentIntensity).toBe(0.7);
    expect(T.fog.color.r).toBeCloseTo(0.6);
    expect(T.fogU.fogDistDensity.value).toBe(0.003);
    expect((T.disc.material as THREE.MeshBasicMaterial).color.r).toBeCloseTo(0.5);
    expect(T.disc.scale.x).toBeCloseTo(0.6);
    expect(T.halo?.material.opacity).toBeCloseTo(0.2);
    expect(T.far.uSeaSun.value.r).toBeCloseTo(0.5);
    expect(strength).toBe(0.9);
    expect(post.rays?.blendMode.opacity.value).toBeCloseTo(0.25);
    expect(post.hueSat?.saturation).toBe(0.1);
  });

  it('leaves the fog to the atmosphere under water', () => {
    const T = targets(true);
    driveDayAir(T, null, { environmentIntensity: 0 }, row, { fog: c(0.6), body: new THREE.Vector3(), cloudBody: new THREE.Vector3(), fade: 1, above: 1, discScale: 1, haloK: 1 });
    expect(T.fog.color.r).toBe(0);
    expect(T.fogU.fogDistDensity.value).toBe(0);
  });
});
