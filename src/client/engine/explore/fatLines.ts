/**
 * Screen-space line marks for the Explorer (E315 M7): LineSegments2 — a width in CSS px, not 1 px GL lines — drawn over
 * everything, a core over a halo so they read on bright sand and sea, dark forest and neon alike (Jake: "way darker,
 * higher contrast"). The Set Explorer's set bounds and a member's copies; the diorama's rim (./diorama.ts).
 *
 *   const box = new FatLines(OUTLINE); scene.add(box.group); box.set(boxEdges([bounds])); box.resize(cssSize);
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/** a line style: a core over a wider halo, widths in CSS px */
export interface LineStyle { readonly core: number; readonly coreWidth: number; readonly halo: number; readonly haloWidth: number; readonly haloOpacity: number }
/** the set's bounds: deep blue (#1447c2) on a pale halo — dark enough for bright sand and sea, haloed for forest and neon */
export const OUTLINE: LineStyle = { core: 0x1447c2, coreWidth: 3, halo: 0xe6f4ff, haloWidth: 6.5, haloOpacity: 0.72 };
/** a stacked diorama's lid rim (./diorama.ts): the same blue, fainter and finer */
export const LID_RIM: LineStyle = { core: 0x1447c2, coreWidth: 1.5, halo: 0xe6f4ff, haloWidth: 3.5, haloOpacity: 0.35 };
/** ◎ a member's copies: amber on a dark halo */
export const LOCATED: LineStyle = { core: 0xffb547, coreWidth: 2, halo: 0x06121c, haloWidth: 4.5, haloOpacity: 0.6 };

/** screen-space line segments (LineSegments2: a width in CSS px, not 1 px GL lines), drawn over everything, core over halo */
export class FatLines {
  readonly group: THREE.Group = new THREE.Group();
  private readonly geo = new LineSegmentsGeometry();
  private readonly mats: LineMaterial[];

  constructor(style: LineStyle) {
    const mat = (color: number, width: number, opacity: number): LineMaterial => {
      const m = new LineMaterial({ linewidth: width, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
      m.color = new THREE.Color(color);
      return m;
    };
    this.mats = [mat(style.halo, style.haloWidth, style.haloOpacity), mat(style.core, style.coreWidth, 1)];
    this.mats.forEach((m, i) => { const l = new LineSegments2(this.geo, m); l.frustumCulled = false; l.renderOrder = 998 + i; this.group.add(l); });
    this.group.visible = false;
  }

  /** the segments (pairs of points, xyz each); none hides it */
  set(positions: Float32Array): void {
    this.group.visible = positions.length > 0;
    if (positions.length > 0) this.geo.setPositions(positions);
  }

  /** the canvas's CSS size (the widths are in its pixels) */
  resize(res: THREE.Vector2): void { for (const m of this.mats) m.resolution.copy(res); }
}
