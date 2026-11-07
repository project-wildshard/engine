import * as THREE from 'three';
import type { BowDrawProfile } from '../../../../shared/engine/combat/bowDraw';
import type { ShotCone } from '../../../../shared/engine/combat/shotSpread';
import type { EquipmentRow } from '../../../../shared/engine/combat/Equipment';
import type { ProjectileKind, WindField } from './projectile';
import type { SkyRig as Sky } from '../../world/skyRig';


/** Authored grip position and aim for a bow view. */
export interface GripPose { pos: THREE.Vector3; aim: THREE.Vector3; cant: number; pitch: number }
/** Trusted bow view strategy supplied by the owning content recipe. */
export interface BowView<Style extends string = string> {
  mat: THREE.Material; mesh: { geometry: THREE.BufferGeometry; nock: THREE.Vector3; shape: (draw: number, nock: number) => void; repaint?: (style: Style) => void };
  nocked: THREE.Mesh; rHand: THREE.Mesh; lSleeve: THREE.Mesh; rSleeve: THREE.Mesh;
  lWrist: THREE.Vector3; rWrist: THREE.Vector3; rHook: THREE.Vector3; rWristDir: THREE.Vector3; roll: THREE.Quaternion;
}
/** Named transitional bow view strategy styles. */
export type BowStyle = string;
/** Bow parameters and injected view strategies; no geometry is supplied by the family. */
export interface BowProfile<Style extends string = string> {
  mounted?: { drawTime: number; rearAngle: number; rearDraw: number; rearSpread: number;
    gaits: readonly { below: number; spread: number }[]; arc: boolean };
  /** Admitted numeric row clocks and loose law; absent keeps the shipping defaults. */
  draw?: BowDrawProfile; loose?: ShotCone & { degrees: number; motion: number; muzzle: number };
  /** Native projectile integration; physical view construction remains injected. */
  projectile?: { gravity: number; drag: number; windCoupling: number; maxFlying: number; substeps: number; lifetime: number };
  family: 'bow'; parent?: EquipmentRow['id']; quiver: number; swayMax: number;
  speedBase: number; speedDraw: number; damageScale: number;
  aimZoom: number; aimVmZoom: number; aimSway: number; aimSpread: number; aimIn: number;
  arcFrom: number; arcColour: number; arcMode: 'setting' | 'aim'; zoomLook: boolean;
  inspectZ: number; inspectHidesArms: boolean; transparentParts: boolean; vmScale: number;
  poses: Record<'rest' | 'drawn' | 'restPort' | 'drawnPort' | 'aim' | 'aimPort', GripPose>;
  arrowX: number; arrowY: number; arrowLength: number;
  build: (sky: Sky) => BowView<Style>; arrow: (sky: Sky) => ProjectileKind; wind: WindField;
}

/** Bounded limb/cap/string publication into the caller's owned Float32 channels.
 * The caller retains baked ownership and its own centreline, section and grip laws.
 * Static vertices, colours, UVs and indices are never rewritten. */
export class BowShape {
  private static readonly claimed = new WeakSet<THREE.BufferGeometry>();
  /** Claim rest backing once; subsequent views own position/normal copies and borrow immutable channels.
   * Call before deformation. The returned dynamic attributes and radius-two bound belong to this view. */
  static prepareGeometry(rest: THREE.BufferGeometry): { geometry: THREE.BufferGeometry; position: THREE.BufferAttribute; normal: THREE.BufferAttribute } {
    const p = rest.getAttribute('position'), n = rest.getAttribute('normal');
    if (!(p instanceof THREE.BufferAttribute) || !(n instanceof THREE.BufferAttribute)
      || !(p.array instanceof Float32Array) || !(n.array instanceof Float32Array)
      || p.itemSize !== 3 || n.itemSize !== 3 || p.count !== n.count || p.count < 1 || p.count > 1_048_576)
      throw new Error('Bow rest geometry requires bounded Float32 position/normal channels');
    const copied = BowShape.claimed.has(rest), geometry = copied ? new THREE.BufferGeometry() : rest;
    const position = new THREE.BufferAttribute(copied ? p.array.slice() : p.array, 3).setUsage(THREE.DynamicDrawUsage);
    const normal = new THREE.BufferAttribute(copied ? n.array.slice() : n.array, 3).setUsage(THREE.DynamicDrawUsage);
    if (copied) {
      for (const name of ['color', 'uv']) if (Object.hasOwn(rest.attributes, name)) geometry.setAttribute(name, rest.getAttribute(name));
      geometry.setIndex(rest.getIndex());
    }
    BowShape.claimed.add(rest);
    geometry.setAttribute('position', position); geometry.setAttribute('normal', normal);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    return { geometry, position, normal };
  }
  private readonly c = new THREE.Vector3(); private readonly t = new THREE.Vector3(); private readonly n = new THREE.Vector3();
  private readonly ringU: readonly number[]; private readonly ringSign: readonly number[];
  private readonly pos: Float32Array; private readonly nrm: Float32Array;
  private lastP = -1; private lastNock = -1;
  private readonly limbAt: NonNullable<ConstructorParameters<typeof BowShape>[1]['limbAt']>;
  private readonly row: ConstructorParameters<typeof BowShape>[0];
  private readonly ports: ConstructorParameters<typeof BowShape>[1];
  constructor(row: {
    readonly ringU: readonly number[]; readonly ringSign: readonly number[];
    readonly radial: number; readonly limbVerts: number; readonly dynVerts: number;
    readonly backScale: number; readonly tipArc: number; readonly tipOffset: number;
    readonly nockX: number; readonly nockY: number; readonly drawZ: number;
    readonly stringRadial: number; readonly stringRadius: number; readonly serving: number;
    /** Immutable producer samples: [half width, half thickness] per ring and grip multiplier per radial vertex. */
    readonly sectionSamples?: { readonly widths: readonly number[]; readonly ridges: readonly number[] };
    /** Analytic circular working limb with a straight grip and an optional kinked rigid tip; exclusive with limbAt. */
    readonly curve?: { readonly gripH: number; readonly limbW: number; readonly kappaRest: number; readonly kappaDraw: number; readonly tipKink?: number };
  }, ports: {
    readonly position: THREE.BufferAttribute; readonly normal: THREE.BufferAttribute;
    readonly tipTop: THREE.Vector3; readonly tipBot: THREE.Vector3; readonly nock: THREE.Vector3;
    readonly limbAt?: (u: number, sign: number, draw: number, at: THREE.Vector3, tangent: THREE.Vector3) => void;
    readonly section?: (u: number) => readonly [number, number];
    readonly ridge?: (u: number, angle: number, sign: number) => number;
  }) {
    this.row=row;this.ports=ports;
    const curve = row.curve;
    if (curve === undefined) {
      if (ports.limbAt === undefined) throw new Error('Missing bow centreline');
      this.limbAt = ports.limbAt.bind(ports);
    } else {
      if (ports.limbAt !== undefined || ![curve.gripH, curve.limbW, curve.kappaRest, curve.kappaDraw, curve.tipKink ?? 0].every(Number.isFinite)
        || curve.gripH <= 0 || curve.gripH > 1e4 || curve.limbW <= 0 || curve.limbW > 1e4
        || curve.kappaRest <= 0 || curve.kappaRest > 1e4 || curve.kappaDraw < 0 || curve.kappaDraw > 1e4 || Math.abs(curve.tipKink ?? 0) > Math.PI)
        throw new Error('Invalid analytic bow curve');
      this.limbAt = (u, sign, draw, at, tangent) => { this.curveAt(curve, u, sign, draw, at, tangent); };
    }
    const {ringU,ringSign,radial,stringRadial,limbVerts,dynVerts}=row;
    if(ringU.length<2||ringU.length>1024||ringU.length!==ringSign.length
      ||!Number.isInteger(radial)||radial<3||radial>64||!Number.isInteger(stringRadial)||stringRadial<3||stringRadial>64
      ||limbVerts!==ringU.length*(radial+1)+2||dynVerts!==limbVerts+8*stringRadial||dynVerts>65536
      ||!ringU.every(u=>Number.isFinite(u)&&u>=0)||!ringSign.every(sign=>sign===-1||sign===1)
      ||![row.backScale,row.tipArc,row.tipOffset,row.nockX,row.nockY,row.drawZ,row.stringRadius,row.serving].every(Number.isFinite)
      ||row.backScale<=0||row.stringRadius<=0||row.serving<0
      ||ports.position.itemSize!==3||ports.normal.itemSize!==3||ports.position.count!==ports.normal.count
      ||ports.position.count<dynVerts||!(ports.position.array instanceof Float32Array)||!(ports.normal.array instanceof Float32Array))
      throw new Error('Invalid bow shape layout');
    const samples = row.sectionSamples;
    if (samples === undefined) {
      if (ports.section === undefined || ports.ridge === undefined) throw new Error('Missing bow cross-section');
    } else if (ports.section !== undefined || ports.ridge !== undefined || samples.widths.length !== ringU.length * 2
      || samples.ridges.length !== ringU.length * (radial + 1)
      || !samples.widths.every(n => Number.isFinite(n) && n > 0 && n <= 1e4)
      || !samples.ridges.every(n => Number.isFinite(n) && n > 0 && n <= 1e4)) throw new Error('Invalid baked bow cross-section');
    this.ringU=[...ringU];this.ringSign=[...ringSign];
    this.pos=ports.position.array;this.nrm=ports.normal.array;
  }
  /** Draw clamps and dirty-range cadence match the existing bow view owner. */
  shape(p: number, nockDraw: number): void {
    if(!Number.isFinite(p)||!Number.isFinite(nockDraw))throw new Error('Invalid bow draw');
    const pc=Math.max(0,Math.min(1.08,p));
    if(Math.abs(pc-this.lastP)<0.0015&&Math.abs(nockDraw-this.lastNock)<0.0015)return;
    this.lastP=pc;this.lastNock=nockDraw;
    const {radial}=this.row,P=this.pos,N=this.nrm,c=this.c,t=this.t,n=this.n,rings=this.ringU.length;
    for(let r=0;r<rings;r++) {
      const u=this.ringU[r]??0,sign=this.ringSign[r]??1;
      this.limbAt(u,sign,pc,c,t);n.set(0,-t.z*sign,t.y*sign);
      const widths = this.row.sectionSamples?.widths;
      const section = widths === undefined ? this.ports.section?.(u) : undefined;
      const hw = widths?.[r * 2] ?? section?.[0], ht = widths?.[r * 2 + 1] ?? section?.[1];
      if (hw === undefined || ht === undefined) throw new Error('Missing bow section sample');
      for(let k=0;k<=radial;k++) {
        const ph=(k/radial)*Math.PI*2,cp=Math.cos(ph),sp=Math.sin(ph),flat=sp<0?this.row.backScale:1;
        const j=(r*(radial+1)+k)*3,rr=this.row.sectionSamples?.ridges[r*(radial+1)+k]??this.ports.ridge?.(u,ph,sign);
        if(rr===undefined)throw new Error('Missing bow grip sample');
        P[j]=cp*hw*rr;P[j+1]=c.y+n.y*sp*ht*flat*rr;P[j+2]=c.z+n.z*sp*ht*flat*rr;
        const ex=cp/hw,en=sp/(ht*flat),l=Math.hypot(ex,en)||1;
        N[j]=ex/l;N[j+1]=(n.y*en)/l;N[j+2]=(n.z*en)/l;
      }
      if(r===0||r===rings-1) {
        const j=(rings*(radial+1)+(r===0?0:1))*3;
        P[j]=0;P[j+1]=c.y+t.y*0.004;P[j+2]=c.z+t.z*0.004;
        N[j]=0;N[j+1]=t.y;N[j+2]=t.z;
      }
    }
    const {tipTop,tipBot,nock}=this.ports,{tipArc,tipOffset}=this.row;
    this.limbAt(tipArc,1,pc,tipTop,t);tipTop.z+=tipOffset;
    this.limbAt(tipArc,-1,pc,tipBot,t);tipBot.z+=tipOffset;
    const braceZ=(tipTop.z+tipBot.z)/2;
    nock.set(this.row.nockX,this.row.nockY,braceZ+(this.row.drawZ-braceZ)*Math.max(-0.12,nockDraw));
    nock.z=Math.max(nock.z,braceZ-0.03);
    this.writeLeg(0,tipBot,nock);this.writeLeg(1,tipTop,nock);
    for(const attr of [this.ports.position,this.ports.normal]) {
      attr.clearUpdateRanges();attr.addUpdateRange(0,this.row.dynVerts*3);attr.needsUpdate=true;
    }
  }
  private curveAt(curve: NonNullable<ConstructorParameters<typeof BowShape>[0]['curve']>, u: number, sign: number, draw: number, at: THREE.Vector3, tangent: THREE.Vector3): void {
    const { gripH, limbW, kappaRest, kappaDraw } = curve;
    const k = kappaRest + kappaDraw * draw;
    if (u <= gripH) { at.set(0, sign * u, 0); tangent.set(0, sign, 0); return; }
    const w = Math.min(u - gripH, limbW), th = k * w;
    let y = gripH + Math.sin(th) / k, z = (1 - Math.cos(th)) / k, a = th;
    if (u > gripH + limbW) { a = k * limbW - (curve.tipKink ?? 0); const extra = u - gripH - limbW; y += Math.cos(a) * extra; z += Math.sin(a) * extra; }
    at.set(0, sign * y, z); tangent.set(0, sign * Math.cos(a), Math.sin(a));
  }
  private writeLeg(leg: number,a: THREE.Vector3,b: THREE.Vector3): void {
    const d=this.c.subVectors(b,a).normalize(),e1=this.t.set(1,0,0);e1.addScaledVector(d,-e1.dot(d)).normalize();
    const e2=this.n.crossVectors(d,e1),{stringRadial,stringRadius,serving}=this.row;
    const o=this.row.limbVerts+leg*4*stringRadial,len=a.distanceTo(b),sv=Math.max(0,1-serving/Math.max(len,1e-3));
    const at=[0,Math.max(0,sv-0.004),sv,1];
    for(let ring=0;ring<4;ring++) {
      const f=at[ring]??1,rad=stringRadius*(ring>=2?1.3:1);
      const cx=a.x+(b.x-a.x)*f,cy=a.y+(b.y-a.y)*f,cz=a.z+(b.z-a.z)*f;
      for(let k=0;k<stringRadial;k++) {
        const ph=(k/stringRadial)*Math.PI*2,cp=Math.cos(ph),sp=Math.sin(ph),j=(o+ring*stringRadial+k)*3;
        const nx=e1.x*cp+e2.x*sp,ny=e1.y*cp+e2.y*sp,nz=e1.z*cp+e2.z*sp;
        this.pos[j]=cx+nx*rad;this.pos[j+1]=cy+ny*rad;this.pos[j+2]=cz+nz*rad;
        this.nrm[j]=nx;this.nrm[j+1]=ny;this.nrm[j+2]=nz;
      }
    }
  }
}
