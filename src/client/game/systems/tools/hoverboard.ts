import * as THREE from 'three';
import { app } from '@wildshard/engine/app/runtime';
import type { EquipContext } from '@wildshard/engine/combat/Equipment';
import { Tool } from '@wildshard/engine/combat/Tool';
import { isMesh } from '@wildshard/engine/combat/view/ranged';
import type { Player } from '@wildshard/engine/player/Player';
import { buildHoverboard } from '@wildshard/engine/render/hoverboardGeometry';

/** The entered hoverboard controller and its owned resources. */
export class Hoverboard extends Tool {
  readonly id = 'tool.hoverboard' as const;
  readonly slot = 'tool' as const;
  readonly actions = ['hover'] as const;
  enabled = true; holster = 0;
  readonly model: THREE.Group = new THREE.Group();
  private blend = 0;                // 0..1 fade
  private lean = 0; private pitch = 0; private bob = 0; private kick = 0; private land = 0;
  private t = 0;
  private pulse: THREE.MeshStandardMaterial;
  private glow: THREE.MeshBasicMaterial;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly top: number;
  private readonly player: Player;
  constructor(camera: THREE.PerspectiveCamera, top: number, player: Player) {
    super({ id: 'tool.hoverboard', meta: { name: 'Hoverboard', icon: 'crossbow', blurb: 'Ride above the ground', category: 'tool' },
      ui: { name: 'Hoverboard', icon: 'crossbow', touch: 'ranged', lockOn: false, melee: false, tracers: false, swapIcon: '', swapName: 'Hover' } });
    this.camera = camera; this.top = top; this.player = player;
    const g = this.model;
    const { pulse, glow } = buildHoverboard(g);
    this.pulse = pulse; this.glow = glow;
    // depth clear so the deck never clips into the terrain; everything renders in the transparent queue after it
    const clearer = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, fog: false })); // fogless: draws nothing, shares the fogless MeshBasic program (as the crossbow's);
    clearer.renderOrder = 999; clearer.frustumCulled = false;
    clearer.onBeforeRender = (renderer) => { renderer.clearDepth(); };
    g.add(clearer);
    g.traverse((o) => {
      if (!isMesh(o) || o === clearer) return;
      o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; o.renderOrder = 1000;
      const mat = o.material as THREE.Material;
      mat.transparent = true; if (mat !== this.glow) mat.depthWrite = true;
    });
    g.visible = false;
    camera.add(g);
  }

  override install(ctx: EquipContext): void {
    super.install(ctx);
    app.input.bind('hover', () => { this.player.setHover(!this.player.hover); }, ctx.scope, () => this.enabled && app.input.allowed('hover'));
    ctx.scope.onDispose(() => { this.model.removeFromParent(); });
  }
  update(dt: number, _t: number): void {
    const p = this.player;
    const on = p.hover;
    this.blend += ((on ? 1 : 0) - this.blend) * Math.min(1, dt / 0.25 * 3.5); // ~0.25 s
    if (this.blend < 0.005 && !on) { this.model.visible = false; return; }
    this.model.visible = true;
    this.t += dt;
    const cam = this.camera;
    const portrait = cam.aspect < 1 ? Math.min(1, (1 - cam.aspect) * 1.6) : 0;
    const port = portrait;

    // lean into lateral velocity (board rolls), nose up under acceleration, sink/rise with the ride-height spring (lagged)
    this.lean += (-Math.max(-1, Math.min(1, p.hoverLat / 7)) * 0.28 - this.lean) * Math.min(1, dt * 6);
    // jump: nose kicks up hard on launch, the board floats level in the air, then compresses on landing
    this.kick = Math.max(this.kick, p.hoverJumpKick);
    if (p.hoverLanded > 0) this.land = Math.min(1, p.hoverLanded / 9);
    this.kick = Math.max(0, this.kick - dt * 2.2); this.land = Math.max(0, this.land - dt * 3);
    const airPitch = p.hoverAir ? 0.06 : 0;
    this.pitch += ((-p.hoverAccel * 0.012 - this.kick * this.kick * 0.55 + airPitch) - this.pitch) * Math.min(1, dt * (this.kick > 0.6 ? 18 : 5));
    const bobT = p.hoverAir ? 0.08 : p.hoverBob * -0.35 - this.land * 0.18;
    this.bob += (bobT - this.bob) * Math.min(1, dt * (this.land > 0.5 ? 16 : 7));
    const idle = Math.sin(this.t * 1.7) * 0.004 + Math.sin(this.t * 2.9) * 0.002;
    const wobble = Math.sin(this.t * 1.3) * 0.006;

    // landscape: y −0.55, z −0.75 (front third under the crossbow). Portrait (Hor+ ~94° tall frame, control bar +
    // button row over the bottom ~23 %): lower and a touch further so the tip clears the row.
    const s = 0.25 + 0.75 * this.blend; // fade = scale + drop
    const drop = (1 - this.blend) * 0.35;
    const py = (-0.55 - port * 0.05) - drop + this.bob + idle;
    const pz = -0.75 - port * 0.12;
    this.model.position.set(-Math.max(-1, Math.min(1, p.hoverLat / 7)) * 0.05, py, pz);
    this.model.rotation.set(this.pitch + wobble * 0.5, 0, this.lean + wobble, 'YXZ');
    this.model.scale.setScalar(s * (1 - port * 0.1));

    // repulsors breathe; brighter with speed
    const sp = Math.hypot(p.velocity.x, p.velocity.z) / this.top;
    const flash = this.kick * this.kick * 3 + this.land * 1.5; // repulsors flare on launch and on touchdown
    this.pulse.emissiveIntensity = 1.8 + Math.sin(this.t * 6) * 0.25 + sp * 1.2 + flash;
    this.glow.opacity = Math.min(1, (0.28 + Math.sin(this.t * 9) * 0.06 + sp * 0.25 + flash * 0.15) * this.blend);
  }
}

/** The shared hoverboard tool registration. */
export const HOVERBOARD_TOOL = { id: 'tool.hoverboard', create: (camera: THREE.PerspectiveCamera, player: Player): Hoverboard => new Hoverboard(camera, 14, player) };
