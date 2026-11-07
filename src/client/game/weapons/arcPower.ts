import {ArcWeaponRowsSchema,type ArcWeaponRows} from '@wildshard/format/heldMelee';
import type {Scope} from '@wildshard/engine/app/scope';
import type { MountedSword } from './mountedBlade';
import { HeldDecision } from '../../../shared/game/weapons/heldDecision';
import * as v from 'valibot';
import { app } from '@wildshard/engine/app/runtime';
import type { Move } from '@wildshard/engine/combat/view/melee';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import { castRay, floorBelow } from '@wildshard/engine/physics/query';
import type { Player } from '@wildshard/engine/player/Player';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { meleeActor } from '@wildshard/engine/combat/Melee';
import * as THREE from 'three';
import { GroundTell } from '@wildshard/engine/game/eliteView';
import { fxMaterial, FX, annulus, type FxMaterial } from '@wildshard/engine/fx/groundFx';

export interface ArcWeaponDeps {
  scope?:Scope;
  scene: THREE.Scene;
  player: Player;
  camera: THREE.Camera;
  animals: RowBodiesView;

  weather:{readonly stormActive:boolean;flash:number};
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export class LightningStrip {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly dir = new THREE.Vector3(); private readonly up = new THREE.Vector3();
  private readonly s1 = new THREE.Vector3(); private readonly s2 = new THREE.Vector3();
  constructor(scene: THREE.Object3D, private readonly n = 14, color: THREE.ColorRepresentation = new THREE.Color(1.6, 1.9, 3.2)) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((n + 1) * 4 * 3);
    this.attr = new THREE.BufferAttribute(this.pos, 3); this.attr.setUsage(THREE.DynamicDrawUsage);
    const idx: number[] = [];
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { const k = r * (n + 1) * 2 + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    g.setAttribute('position', this.attr); g.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.mat.name = 'weapon-lightning';
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 18;
    scene.add(this.mesh);
  }
  get alpha(): number { return this.mat.opacity; }
  set alpha(a: number) { this.mat.opacity = Math.max(0, Math.min(1, a)); this.mesh.visible = a > 0.01; }

  set(a: THREE.Vector3, b: THREE.Vector3, jag: number, width: number): void {
    const n = this.n, P = this.pos, dir = this.dir;
    dir.subVectors(b, a); const L = dir.length() || 1; dir.multiplyScalar(1 / L);

    const ax = Math.abs(dir.y) < 0.9 ? this.up.set(0, 1, 0) : this.up.set(1, 0, 0);
    const s1 = this.s1.crossVectors(dir, ax).normalize(), s2 = this.s2.crossVectors(dir, s1).normalize();
    for (let i = 0; i <= n; i++) {
      const u = i / n, inner = i > 0 && i < n;
      const ox = inner ? (app.rng.stream('cosmetic').next() - 0.5) * jag * 2 : 0, oy = inner ? (app.rng.stream('cosmetic').next() - 0.5) * jag * 2 : 0;
      const cx = a.x + (b.x - a.x) * u + s1.x * ox + s2.x * oy, cy = a.y + (b.y - a.y) * u + s1.y * ox + s2.y * oy, cz = a.z + (b.z - a.z) * u + s1.z * ox + s2.z * oy;
      const w = width * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.08)));
      for (let r = 0; r < 2; r++) {
        const s = r === 0 ? s1 : s2, k = (r * (n + 1) * 2 + i * 2) * 3;
        P[k] = cx - s.x * w; P[k + 1] = cy - s.y * w; P[k + 2] = cz - s.z * w;
        P[k + 3] = cx + s.x * w; P[k + 4] = cy + s.y * w; P[k + 5] = cz + s.z * w;
      }
    }
    this.attr.needsUpdate = true;
  }
}

/** Client-only lightning presentation and native contacts. The guest selects
 * targets, arc chains and delayed area contacts at <=10 Hz. */
export class ArcWeaponPower {
  private sabre: MountedSword | null = null;
  private wasSwinging = false;
  private pendingSwing: Move | null = null;
  private readonly crescent: THREE.Mesh;
  private readonly crescentMat: FxMaterial;
  private crescentT = -1;
  private readonly crescentFrom = new THREE.Vector3();
  private readonly crescentDir = new THREE.Vector3();
  private readonly arcs: LightningStrip[];
  private arcT = 0;
  private readonly bolt:LightningStrip;private boltT=0;
  private readonly ring: GroundTell;
  private readonly callAt = new THREE.Vector3();
  private callT = -1;
  private elapsed=0;private readonly law:HeldDecision;private readonly rows:ArcWeaponRows;

  constructor(private readonly deps: ArcWeaponDeps,input:unknown) {
    this.rows=v.parse(ArcWeaponRowsSchema,input);this.law=new HeldDecision(this.rows.program,deps.scope);
    this.crescentMat = fxMaterial(FX.ring, new THREE.Color(1.3, 1.7, 3.0), 0);
    this.crescentMat.uniforms.uP.value.x = 1.4;
    const g = annulus(1.3, 2.5, 28, Math.PI * 0.7);
    g.rotateY(Math.PI / 2 - Math.PI * 0.35);   // the arc bows forward (−z) around the flight line
    this.crescent = new THREE.Mesh(g, this.crescentMat);
    this.crescent.frustumCulled = false; this.crescent.visible = false; this.crescent.renderOrder = 17;
    deps.scene.add(this.crescent);
    this.arcs = [new LightningStrip(deps.scene, 10), new LightningStrip(deps.scene, 10)];this.bolt=new LightningStrip(deps.scene,18);
    this.ring = new GroundTell(deps.scene, 'ring', new THREE.Color(2.2, 1.7, 0.6));
  }

  onSwingStart(move: Move): void { this.pendingSwing = move; }

  get applied(): boolean { return this.sabre !== null; }

  apply(sabre: MountedSword): void {
    sabre.row = { ...sabre.row, id: this.rows.item, meta: { ...sabre.meta, name: this.rows.name } };
    if (this.sabre === sabre) return;
    this.sabre = sabre;
    sabre.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats: readonly unknown[] = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) { m.color.setRGB(...this.rows.blue); m.emissive.setRGB(...this.rows.glow); m.emissiveIntensity = 1; }
    });
  }

  update(dt: number, t: number): void {
    const sb = this.sabre;
    this.ring.setTime(t);
    this.elapsed+=dt;
    if(sb!==null&&this.elapsed>=.1-1e-9){
     const elapsed=this.elapsed;this.elapsed=0;
     const sw=sb.swinging,m=sb.mount,origin=this.callT>=0?this.callAt:this.deps.player.position,animals=this.deps.animals.animals.filter(a=>a.alive&&!a.hidden&&a!==this.deps.player.mountedOn&&a.mem['owned']!==1).sort((a,b)=>a.position.distanceToSquared(origin)-b.position.distanceToSquared(origin)).slice(0,8);
     const cam=this.deps.camera;cam.getWorldPosition(_o);cam.getWorldDirection(_d);_d.y=Math.max(-.25,Math.min(.25,_d.y));_d.normalize();_o.y-=.35;
     const candidates=animals.map((a,i)=>{_v.set(a.position.x,a.position.y+a.dims.bodyY*a.scale,a.position.z).sub(_o);const along=_v.dot(_d);return {id:i+1,live:Number(a.alive&&!a.hidden&&a!==this.deps.player.mountedOn&&a.mem['owned']!==1),along,side:_w.copy(_d).multiplyScalar(along).sub(_v).length(),radius:a.dims.bodyRadius*a.scale,x:a.position.x,y:a.position.y,z:a.position.z,scale:a.scale};});
     const result=this.law.update(elapsed,{mode:2,swing:Number(this.pendingSwing!==null||(sw&&!this.wasSwinging)),mounted:Number(m!==null),speed:m?.speed??0,heavy:Number(this.pendingSwing?.name==='heavy'||sb.heavySwing),call:this.callT,storm:Number(this.deps.weather.stormActive),callX:this.callAt.x,callZ:this.callAt.z,...this.rows.powers},candidates);
     this.pendingSwing=null;this.wasSwinging=sw;
     if(result!==null){
      this.callT=result['call']??-1;
      if(result['action']===1)this.throwCrescent(animals,result);
      if(result['action']===2)this.callBolt();
      if(result['detonate']===1){this.ring.hide();this.bolt.set(_o.copy(this.callAt).add(_w.set(0,30,0)),this.callAt,1,.08);this.bolt.alpha=1;this.boltT=.35;this.deps.weather.flash=1;
       for(let i=0;i<animals.length;i++){const a=animals[i],mask=result[`aoe${Math.floor(i/24)}`]??0;if(a===undefined||(mask&(1<<(i%24)))===0)continue;
        _d.set(a.position.x-this.callAt.x,.5,a.position.z-this.callAt.z).normalize();a.headWorld(_v);
        app.combat.hit({source:'env',sourceTags:['actor.player',this.rows.item,'dmg.aoe'],target:a.combatActor(),amount:result['callDamage']??0,point:_v,dir:_d,from:this.callAt,throughWalls:true,weaponId:this.rows.item,moveId:'move.calldown'});
       }
      }
     }
    }
    if (this.crescentT >= 0) {
      this.crescentT += dt;
      const u = Math.min(1, this.crescentT / this.rows.powers.crescentTime);
      this.crescent.position.copy(this.crescentFrom).addScaledVector(this.crescentDir, 1.2 + u * (this.rows.powers.crescentRange - 1.2));
      this.crescentMat.uniforms.uAlpha.value = (1 - u * u) * 1.2;
      this.crescentMat.uniforms.uTime.value = t;
      if (u >= 1) { this.crescentT = -1; this.crescent.visible = false; }
    }
    if(this.boltT>0){this.boltT=Math.max(0,this.boltT-dt);this.bolt.alpha=this.boltT/.35;}
    if (this.arcT > 0) { this.arcT -= dt; for (const a of this.arcs) a.alpha = Math.min(a.alpha, this.arcT / 0.25); }

    if(this.callT>=0)this.ring.ring(this.callAt.x,this.callAt.z,this.rows.powers.callRadius,.9*(.6+.4*Math.sin(this.callT*30)));
  }

  private throwCrescent(animals:readonly Animal[],result:Readonly<Record<string,number>>): void {
    const cam = this.deps.camera;
    cam.getWorldPosition(_o); cam.getWorldDirection(_d);
    _d.y = Math.max(-0.25, Math.min(0.25, _d.y)); _d.normalize();
    this.crescentFrom.copy(_o).y -= 0.35;
    this.crescentDir.copy(_d);
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _d);
    this.crescent.quaternion.copy(_q);
    this.crescent.position.copy(this.crescentFrom);
    this.crescent.visible = true; this.crescentT = 0;

    const best=animals[(result['target']??0)-1];if(best===undefined)return;
    const dmg=result['damage']??0;
    const hitA = best;
    hitA.headWorld(_v);
    const first = app.combat.hit({ source: 'env', sourceTags: ['actor.player', this.rows.item, 'dmg.melee'],
      target: meleeActor(hitA), amount: dmg, point: _v, dir: _d, from: this.deps.camera.position, weaponId: this.rows.item, moveId: 'move.crescent' });
    if (!first) return;

    let from:Animal=hitA;
    for(let i=0;i<2;i++){
      const next=animals[(result[`arc${i+1}`]??0)-1];if(next===undefined)break;
      from.headWorld(_o); next.headWorld(_v);
      _w.subVectors(_v, _o).normalize();
      const contact = app.combat.hit({ source: 'env', sourceTags: ['actor.player', this.rows.item, 'dmg.melee'],
        target: meleeActor(next), amount: dmg, point: _v, dir: _w, from: _o, weaponId: this.rows.item, moveId: 'move.crescent.arc' });
      if (!contact) break;
      const arc = this.arcs[i];
      if (arc) { arc.set(_o, _v, 0.45, 0.09); arc.alpha = 1; this.arcT = 0.35; }
      _w.subVectors(_v, _o).normalize();
      from = next;
    }
  }

  private callBolt(): void {
    const cam = this.deps.camera;
    cam.getWorldPosition(_o); cam.getWorldDirection(_d);
    const ph = app.physics;
    const hit = ph ? castRay(ph, _o, _d, this.rows.powers.callRange) : null;
    if (hit) _v.set(hit.point.x, hit.point.y, hit.point.z);
    else _v.copy(_o).addScaledVector(_w.set(_d.x, 0, _d.z).normalize(), this.rows.powers.callRange);

    this.callAt.set(_v.x, (ph ? floorBelow(ph, _v.x, _v.z, _v.y + 0.5, 80) : undefined) ?? heightAt(_v.x, _v.z), _v.z);
    this.callT = 0;
  }
}
