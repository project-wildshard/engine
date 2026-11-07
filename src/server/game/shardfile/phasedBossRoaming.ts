import { Vector3 } from 'three';
import { borrowedDecisionControl } from './borrowedDecisions';
import type { RoamingBossBody, RoamingBossRow, RoamingBossPorts, RoamingBossLane, RoamingBossHazard, RoamingBossState, RoamingBossFight } from "../plugin/bossPhase";

const headingTo = (ax: number,az: number,bx: number,bz: number): number => Math.atan2(bx-ax,bz-az);
const clamp01 = (v: number): number => Math.min(1,Math.max(0,v));
function smoothstep(x: number,min: number,max: number): number {
  if(x<=min)return 0;if(x>=max)return 1;
  const u=(x-min)/(max-min);return u*u*(3-2*u);
}
function burnTick(acc: number,dt: number,inside: boolean,every: number): {acc: number;bites: number} {
  if(!inside)return {acc:0,bites:0};
  let a=acc+dt,bites=0;while(a>=every){a-=every;bites++;}return {acc:a,bites};
}
function wallPush(dist: number,row: {wall: number;shoveBase: number;shoveGain: number;shoveSpan: number}): number {
  return dist<=row.wall?0:row.shoveBase+row.shoveGain*Math.min(1,(dist-row.wall)/row.shoveSpan);
}

abstract class RoamingGoals<B extends RoamingBossBody,L,K extends string,A extends string,Q extends string> {
  phase = 0;
  mode = 'dormant';
  modeT = 0;
  strikeCd: number; burstCd: number; summonCd: number; chain = 0;
  open = 0;
  protected abstract readonly ctx: Pick<RoamingBossPorts<B,L,never,K,A,Q>,'player'|'hurt'|'trauma'|'shot'>;
  protected abstract readonly tellRing: RoamingBossPorts<B,L,never,K,A,Q>['views']['tell'];
  protected abstract readonly waves: readonly { on: boolean }[];
  protected abstract readonly lane: RoamingBossLane<B,L>;
  protected abstract contact: RoamingBossPorts<B,L,never,K,A,Q>['contact'];
  protected abstract tickWaves(k: B, dt: number, t: number): void;
  protected abstract burstNow(k: B): void;
  protected abstract aliveAdds(): number;
  protected abstract callAdds(n: number): void;
  protected abstract action(k: B, action: A): void;
  protected abstract roar(k: B): void;
  protected readonly row: RoamingBossRow<K,A,Q>;
  protected constructor(row: RoamingBossRow<K,A,Q>) { this.row = row; this.mode = row.names.idle; this.strikeCd = row.initial.strikeCd; this.burstCd = row.initial.burstCd; this.summonCd = row.initial.summonCd; }
  protected setMode(mode: string): void { this.mode = mode; this.modeT = 0; }

  /** Apply admitted guest requests to the existing arena mechanics; no action selection or decision clock lives here. */
  protected fight(k: B, dt: number, t: number): void {
    const f = this.row.decision, p = this.ctx.player.position, m = k.mem;
    const next = this.row.decision.modes[m[f.mode] ?? 0];
    if (next === undefined) throw new Error('Invalid guest encounter mode');
    if (next !== this.mode) {
      this.setMode(next);
      if(next===this.row.names.recover)this.ctx.shot(this.row.sounds.roar,k.position);
      if (next === this.row.names.strike) { this.action(k,this.row.strike.action); k.startAttack(this.row.strike.clip.duration); }
      if (next === this.row.names.burst) { this.action(k,this.row.burst.action); k.startAttack(this.row.burst.clip.duration); }
      if (next === this.row.names.summon) { this.action(k,this.row.summon.action); k.startAttack(this.row.summon.clip.duration); this.ctx.shot(this.row.sounds.intro,k.position); }
    }
    this.modeT=m[f.modeT]??0; this.strikeCd=m[f.strikeCd]??0; this.burstCd=m[f.burstCd]??0; this.summonCd=m[f.summonCd]??0; this.chain=m[f.chain]??0;
    const request=m[f.request]??0;
    if (!Number.isInteger(request)||request<0||request>4) throw new Error('Invalid guest arena request');
    m[f.request]=0;
    if(request===1){this.tellRing.hide();this.contact(k,this.row.strike.id,damage=>{this.ctx.hurt(k,damage);this.ctx.trauma(this.row.strike.contactTrauma);});this.ctx.trauma(this.row.strike.trauma);}
    if(request===2){this.tellRing.hide();this.burstNow(k);}
    if(request===3)this.callAdds(this.row.summon.count);
    if(request===4&&!this.lane.busy){this.action(k,this.row.lanes.action);this.lane.start(k,p.x,p.z,this.row.lanes.tell);this.roar(k);}
    this.tellRing.setTime(t);k.lookTarget.copy(p);k.lookWeight=1;
    const wantOpen=this.mode===this.row.opening.mode||(this.mode===this.row.opening.lanesMode&&this.lane.state==='skid')?1:0;
    this.open=clamp01(this.open+(wantOpen>this.open?dt*this.row.opening.inRate:-dt*this.row.opening.outRate));
    this.tickWaves(k,dt,t);
    if(this.lane.busy){this.lane.update(k,dt,t,p,damage=>{this.ctx.hurt(k,damage);this.ctx.trauma(this.row.lanes.trauma);});
      if(this.lane.state==='run'&&this.lane.t<dt*this.row.lanes.soundTicks)this.ctx.shot(this.row.sounds.burst,k.position);}
    const telling=this.mode===this.row.names.strike?this.row.strike:this.mode===this.row.names.burst?this.row.burst:undefined;
    if(telling!==undefined){const u=Math.min(1,this.modeT/telling.clip.duration);this.tellRing.ring(k.position.x,k.position.z,telling.radius,
      telling.tell[0]+telling.tell[1]*u*(telling.tell[2]+telling.tell[3]*Math.sin(t*telling.tell[4])));}
    m[f.rings]=Number(this.waves.some(w=>w.on));m[f.adds]=this.aliveAdds();m[f.lane]=Number(this.lane.busy);
  }

}

abstract class RoamingCore<B extends RoamingBossBody,L,R,K extends string,A extends string,Q extends string> extends RoamingGoals<B,L,K,A,Q> {
  body: B | null = null;
  protected abstract override readonly ctx: Pick<RoamingBossPorts<B,L,R,K,A,Q>,'player'|'hurt'|'trauma'|'shot'>;
  protected abstract override readonly waves: { r: number; on: boolean; hit: boolean; delay: number }[];
  protected abstract readonly addLanes: readonly RoamingBossLane<B,L>[];
  readonly hazardsState: RoamingBossHazard[];
  protected addsState: { a: B; lane: RoamingBossLane<B,L>; mode: 'approach'|'charge' }[] = [];
  protected readonly rng: RoamingBossPorts<B,L,R,K,A,Q>['random'];
  invuln = false; lockHp = 0;
  sealK = 0; sealed = false;
  darkK = 0; glow = 0;
  present = false;
  won = false;

  protected constructor(row: RoamingBossRow<K,A,Q>,random: RoamingBossPorts<B,L,R,K,A,Q>['random']) { super(row); this.rng = random; this.hazardsState = Array.from({length:row.hazards.count},()=>({x:0,z:0,y:0,fallT:-1,acc:0})); }

  // ── the hosts' bodies and views ──
  /** the terrain's height (the page's terrainHeight, the host's height query) */
  protected abstract groundAt(x: number, z: number): number;
  protected abstract makeBody(): B;
  protected abstract retireBody(k: B): void;
  protected abstract parkBody(k: B): void;
  protected abstract unparkBody(k: B): void;
  protected abstract spawnAdd(kind: K, x: number, z: number, yaw: number): B;
  protected abstract retireAdd(a: B): void;
  protected onWeakPoint(_p: Vector3): boolean { return false; }
  protected glowTo(_v: number): void { /* view */ }
  protected hazardsHung(_on: boolean): void { /* view */ }
  protected introFocus(k: B, out: Vector3): Vector3 { return out.copy(k.position); }
  protected room(_dt: number, _t: number): void { /* view */ }
  protected hazardView(_i: number, _f: RoamingBossHazard, _t: number, _event: 'drop' | 'fall' | 'land' | 'burn' | 'out' | 'placed'): void { /* view */ }
  protected addView(_a: B, _event: 'in' | 'out'): void { /* view */ }
  protected lightOn(): void { /* view */ }
  protected lightOff(): void { /* view */ }
  protected burstFx(_k: B): void { /* view */ }

  // ── BossScript ──
  get weatherHold(): number { return this.sealK; }
  get hpFrac(): number { const k = this.body; return k ? Math.max(0, k.hp / k.maxHp) : 0; }
  get shielded(): boolean { return this.invuln; }
  get dead(): boolean { return this.body !== null && !this.body.alive; }
  inArena(p: Vector3): boolean { return this.present && Math.hypot(p.x - this.row.origin.x, p.z - this.row.origin.z) < this.row.arena.entry; }
  seal(on: boolean): void { this.sealed = on; }
  clampHp(frac: number): void { const k = this.body; if (k) { k.hp = Math.max(1, Math.round(k.maxHp * frac)); this.lockHp = k.hp; } }
  setInvulnerable(on: boolean): void { this.invuln = on; if (on && this.body) this.lockHp = this.body.hp; }
  rewardPoint(): Vector3 { return new Vector3(this.row.origin.x, this.groundAt(this.row.origin.x, this.row.origin.z + this.row.points.rewardZ) + this.row.points.rewardY, this.row.origin.z + this.row.points.rewardZ); }
  respawnPoint(): { pos: Vector3; yaw: number } { return { pos: new Vector3(this.row.origin.x, this.groundAt(this.row.origin.x, this.row.origin.z + this.row.points.respawnZ), this.row.origin.z + this.row.points.respawnZ), yaw: this.row.points.respawnYaw }; }

  protected spawnBody(): B {
    const old = this.body;
    if (old) this.retireBody(old);
    const a = this.makeBody();
    a.herd = this.row.reset.herd;
    this.body = a;
    return a;
  }

  setPresent(on: boolean): void {
    if (on === this.present) return;
    this.present = on;
    const k = this.body;
    if (on) { if (k === null || !k.alive) this.spawnBody(); else this.unparkBody(k); }
    else {
      if (k) { if (k.alive) this.parkBody(k); else { this.retireBody(k); this.body = null; } }
      this.clearAdds(); this.hideTells(); this.setHazards(false);
      this.sealed = false; this.mode = this.row.names.idle;
      this.lightOff();
    }
  }

  reset(phase: number): void {
    this.phase = phase; this.won = false;
    if (!this.present) this.setPresent(true);
    let k = this.body;
    if (k === null || !k.alive) k = this.spawnBody();
    const control = borrowedDecisionControl(k); control.fighting = false; control.restart(); control.phase = phase;
    k.hp = Math.max(1, Math.round(k.maxHp * (this.row.phases[phase]?.at ?? 1)));
    k.setMotion(0, 0, 1); k.lookWeight = 0; k.cancelAttack();
    this.clearAdds(); this.hideTells();
    this.hazardsHung(phase < this.row.hazards.fromPhase);
    this.setHazards(phase >= this.row.hazards.fromPhase);
    this.glow = this.row.reset.glow; this.glowTo(this.glow); this.open = 0;
    this.darkK = 0;
    this.mode = this.row.names.idle;
    this.strikeCd = this.row.reset.strikeCd; this.burstCd = this.row.reset.burstCd; this.summonCd = this.row.reset.summonCd;
    this.writeDecision();
  }

  intro(t: number, short: boolean): Vector3 {
    const k = this.body;
    if (!k) return new Vector3(this.row.origin.x, this.groundAt(this.row.origin.x, this.row.origin.z) + this.row.intro.absentHeight, this.row.origin.z);
    const len = short ? this.row.intro.short : this.row.intro.long;
    if (this.mode !== this.row.names.intro) { this.mode = this.row.names.intro; this.modeT = 0; this.ctx.shot(this.row.sounds.intro, k.position); }
    this.modeT = t;
    this.glow = Math.max(this.row.reset.glow, smoothstep(t, this.row.intro.glowStart, len * this.row.intro.glowEnd));
    this.glowTo(this.glow);
    k.lookTarget.copy(this.ctx.player.position); k.lookWeight = Math.min(1, t / (len * this.row.intro.lookEnd));
    if (t > len * this.row.intro.roarAt && t - this.row.intro.crossingStep <= len * this.row.intro.roarAt) { this.ctx.shot(this.row.sounds.roar, k.position); this.roar(k); }
    this.lightOn();
    return this.introFocus(k, new Vector3());
  }

  begin(phase: number): void {
    this.phase = phase; this.glow = this.row.begin.glow; this.glowTo(this.row.begin.glow);
    this.writeDecision(); if(this.body!==null){const control=borrowedDecisionControl(this.body);control.phase=phase;control.fighting=true;}
    this.lightOn();
    if (phase >= this.row.hazards.fromPhase && this.addsState.length === 0) this.summonCd = this.row.begin.summonDelay;
  }

  enterPhase(phase: number): void {
    this.phase = phase; if(this.body!==null)borrowedDecisionControl(this.body).phase=phase;
    this.hideTells(); this.lane.cancel();
    const enter = this.row.phases[phase]?.enter;
    if (enter) {
      if (enter.drop) this.dropHazards();
      if (enter.summonDelay !== undefined) this.summonCd = enter.summonDelay;
      this.setMode(enter.mode);
      if (enter.resetChain) this.chain = 0;
      if (enter.roar) this.ctx.shot(this.row.sounds.roar, this.body?.position ?? new Vector3(this.row.origin.x, 0, this.row.origin.z));
    }
  }

  victory(): void {
    this.won = true; this.mode = this.row.names.dead;
    this.hideTells(); this.lane.cancel();
    for (const th of this.addsState) { if (th.a.alive) { this.addView(th.a, 'out'); this.retireAdd(th.a); } th.lane.cancel(); }
    this.addsState = [];
    this.setHazards(false);
    this.glow = this.row.victoryGlow; this.glowTo(this.glow);
    this.lightOff();
  }

  update(dt: number, t: number, fighting: boolean): void {
    const k = this.body; if(k!==null){const control=borrowedDecisionControl(k);control.fighting=fighting;control.phase=this.phase;}
    this.sealK = clamp01(this.sealK + (this.sealed ? dt / this.row.seal.inSeconds : -dt / this.row.seal.outSeconds));
    this.darkK = clamp01(this.darkK + ((this.row.phases[this.phase]?.darkness === true && !this.won && this.sealed) ? dt / this.row.seal.darkIn : -dt / this.row.seal.darkOut));
    this.room(dt, t);
    this.tickHazards(dt, t, fighting);
    if (!k) return;
    if (this.invuln && k.hp < this.lockHp) k.hp = this.lockHp;
    if (this.sealed) this.softWall();
    if (!fighting || !k.alive) { this.open = Math.max(0, this.open - dt * this.row.opening.inactiveRate); return; }
    this.fight(k, dt, t);
    this.tickAdds(dt, t);
    const kd = Math.hypot(k.position.x - this.row.origin.x, k.position.z - this.row.origin.z);
    if (kd > this.row.arena.leash) {
      k.position.x = this.row.origin.x + (k.position.x - this.row.origin.x) / kd * this.row.arena.leash; k.position.z = this.row.origin.z + (k.position.z - this.row.origin.z) / kd * this.row.arena.leash;
      this.lane.recoverNow();
    }
  }

  damageMul(a: B, p: Vector3): number {
    if (a !== this.body) return 1;
    if (this.invuln || this.mode === this.row.names.idle) return this.row.damage.invulnerable;
    if (this.onWeakPoint(p)) return this.open > this.row.damage.opening ? this.row.damage.weakOpen : this.row.damage.weakClosed;
    return this.row.modes[this.mode]?.damage ?? 1;
  }

  protected override burstNow(k: B): void {
    this.burstFx(k);
    this.ctx.shot(this.row.sounds.burst, k.position);
    this.ctx.trauma(this.row.burst.trauma);
    const n = this.row.phases[this.phase]?.rings ?? 1;
    this.waves.forEach((w, i) => { w.on = i < n; w.r = this.row.burst.radius; w.hit = false; w.delay = i * this.row.rings.gap; });
  }
  protected override tickWaves(k: B, dt: number, t: number): void {
    const p = this.ctx.player.position;
    const pd = Math.hypot(p.x - this.row.origin.x, p.z - this.row.origin.z) < this.row.arena.fog ? Math.hypot(p.x - k.position.x, p.z - k.position.z) : Infinity;
    this.waves.forEach((w, i) => {
      if (!w.on) { this.waveView(i, t, null); return; }
      if (w.delay > 0) { w.delay -= dt; return; }
      w.r += dt * this.row.rings.speed;
      this.waveView(i, t, k.position);
      if (!w.hit && pd !== Infinity) w.hit = this.contact(k, this.row.rings.strike, (damage) => { this.ctx.hurt(k, damage, true); this.ctx.trauma(this.row.rings.trauma); }, { ringRadius: w.r, airborne: !this.ctx.player.onGround });
      if (w.r > this.row.arena.fog) { w.on = false; this.waveView(i, t, null); }
    });
  }
  /** a root ring's view round `at` at its radius, or hidden (null) */
  protected waveView(_i: number, _t: number, _at: Vector3 | null): void { /* view */ }

  // ── addsState ──
  protected override aliveAdds(): number { return this.addsState.filter((th) => th.a.alive).length; }
  protected override callAdds(n: number): void {
    const p = this.ctx.player.position;
    for (let i = 0; i < n; i++) {
      const lane = this.addLanes.find((l) => !this.addsState.some((th) => th.lane === l && th.a.alive));
      if (!lane) break;
      const ang = this.rng.call.next() * Math.PI * 2, x = this.row.origin.x + Math.sin(ang) * this.row.adds.radius, z = this.row.origin.z + Math.cos(ang) * this.row.adds.radius;
      const kind = this.row.adds.kinds[i % this.row.adds.kinds.length];
      if (kind === undefined) throw new Error('Phased boss has no add kind');
      const a = this.spawnAdd(kind, x, z, headingTo(x, z, p.x, p.z));
      this.addsState = this.addsState.filter((th) => th.lane !== lane);
      this.addsState.push({ a, lane, mode: 'approach' });
      this.addView(a, 'in');
      this.ctx.shot(this.row.sounds.add, a.position);
    }
  }
  protected tickAdds(dt: number, t: number): void {
    const p = this.ctx.player.position;
    for (const th of this.addsState) {
      const a = th.a;
      if (!a.alive) { th.lane.cancel(); continue; }
      a.lookTarget.copy(p); a.lookWeight = 1;
      if (th.mode === 'charge') { th.lane.update(a, dt, t, p, (dmg) => { this.ctx.hurt(a, dmg); this.ctx.trauma(this.row.adds.trauma); }); if (!th.lane.busy) th.mode = 'approach'; }
      else {
        const d = Math.hypot(p.x - a.position.x, p.z - a.position.z);
        a.setMotion(headingTo(a.position.x, a.position.z, p.x, p.z), d > this.row.adds.far ? this.row.adds.fast : d > this.row.adds.near ? this.row.adds.slow : 0, this.row.adds.turn);
        if (d < this.row.adds.chargeRange && this.rng.charge.next() < dt * this.row.adds.rate) { th.lane.start(a, p.x, p.z, this.row.adds.tell); th.mode = 'charge'; this.ctx.shot(this.row.sounds.charge, a.position); }
      }
      const ad = Math.hypot(a.position.x - this.row.origin.x, a.position.z - this.row.origin.z);
      if (ad > this.row.arena.wall + this.row.adds.leashPad) { a.position.x = this.row.origin.x + (a.position.x - this.row.origin.x) / ad * (this.row.arena.wall + this.row.adds.leashPad); a.position.z = this.row.origin.z + (a.position.z - this.row.origin.z) / ad * (this.row.arena.wall + this.row.adds.leashPad); }
    }
  }
  protected clearAdds(): void {
    for (const th of this.addsState) { th.lane.cancel(); this.retireAdd(th.a); }
    this.addsState = [];
  }

  // ── the hazardsState fall ──
  private dropHazards(): void {
    const k = this.body;
    if (!k) return;
    this.hazardsState.forEach((f, i) => {
      const ang = k.yaw + (i - this.row.hazards.angleStart) * this.row.hazards.angleStep + this.row.hazards.angleOffset, r = this.row.hazards.radius + i * this.row.hazards.radiusStep;
      f.x = this.row.origin.x + Math.sin(ang) * r; f.z = this.row.origin.z + Math.cos(ang) * r; f.y = this.groundAt(f.x, f.z);
      f.fallT = 0; f.acc = 0;
      this.hazardView(i, f, 0, 'drop');
    });
    this.hazardsHung(false);
  }
  protected setHazards(on: boolean): void {
    this.hazardsState.forEach((f, i) => {
      if (on) {
        const ang = (i - this.row.hazards.angleStart) * this.row.hazards.angleStep + this.row.hazards.angleOffset, r = this.row.hazards.radius + i * this.row.hazards.radiusStep;
        f.x = this.row.origin.x + Math.sin(ang) * r; f.z = this.row.origin.z + Math.cos(ang) * r; f.y = this.groundAt(f.x, f.z);
        f.fallT = 1; this.hazardView(i, f, 0, 'placed');
      } else { f.fallT = -1; this.hazardView(i, f, 0, 'out'); }
    });
  }
  private tickHazards(dt: number, t: number, fighting: boolean): void {
    this.hazardsState.forEach((f, i) => {
      if (f.fallT < 0) return;
      if (f.fallT < 1) {
        f.fallT = Math.min(1, f.fallT + dt / this.row.hazards.fallSeconds);
        this.hazardView(i, f, t, f.fallT >= 1 ? 'land' : 'fall');
        return;
      }
      this.hazardView(i, f, t, 'burn');
      if (fighting && !this.won) {
        let inside = false;
        const actor = this.body;
        if (actor) this.contact(actor, this.row.hazards.strike, () => { inside = true; }, { origin: { x: f.x, y: f.y, z: f.z } });
        const r = burnTick(f.acc, dt, inside, this.row.hazards.every);
        f.acc = r.acc;
        if (r.bites > 0 && actor) this.ctx.hurt(actor, this.row.hazards.damage * r.bites, true);
      }
    });
  }

  // ── the room ──
  protected hideTells(): void { this.tellRing.hide(); this.waves.forEach((w, i) => { w.on = false; this.waveView(i, 0, null); }); this.lane.cancel(); }

  private softWall(): void {
    const pl = this.ctx.player, p = pl.position;
    const dx = p.x - this.row.origin.x, dz = p.z - this.row.origin.z, d = Math.hypot(dx, dz);
    const push = wallPush(d, this.row.arena);
    if (push > 0 && d > this.row.arena.epsilon) pl.shove(this.row.origin.x + dx / d * (d + this.row.arena.shoveDistance), this.row.origin.z + dz / d * (d + this.row.arena.shoveDistance), push);
    if (d > this.row.arena.fog - this.row.arena.wallPad) { p.x = this.row.origin.x + dx / d * (this.row.arena.fog - this.row.arena.clampPad); p.z = this.row.origin.z + dz / d * (this.row.arena.fog - this.row.arena.clampPad); }
  }

  private writeDecision():void {
    const k=this.body;if(k===null)return;const f=this.row.decision;
    for(const [name,value] of [[f.mode,f.modes.indexOf(this.mode)],[f.modeT,this.modeT],[f.strikeCd,this.strikeCd],[f.burstCd,this.burstCd],[f.summonCd,this.summonCd],[f.chain,this.chain],[f.phase,this.phase]] as const) k.mem[name]=value;
  }

  // ── the continuation (the headless runtime's; bodies by entity id) ──
  /** Plain continuation names the actual retained bodies by their entity ids. */
  snapshot(): RoamingBossState<L,R> {
    const decision=this.body===null?undefined:borrowedDecisionControl(this.body).snapshot();
    if(decision!==undefined&&typeof decision!=='string')throw new Error('Invalid borrowed decision continuation');
    return { ...(decision===undefined?{}:{decision}), body: this.body === null ? null : this.body.entityId, present: this.present, sealed: this.sealed, sealK: this.sealK, darkK: this.darkK, glow: this.glow,
      invuln: this.invuln, lockHp: this.lockHp, won: this.won, phase: this.phase, mode: this.mode, modeT: this.modeT, strikeCd: this.strikeCd, burstCd: this.burstCd,
      summonCd: this.summonCd, chain: this.chain, open: this.open, lane: this.lane.snapshot(), rings: this.waves.map(w => ({ r: w.r, on: w.on, hit: w.hit, delay: w.delay })),
      hazards: this.hazardsState.map(f => ({ ...f })), adds: this.addsState.map(th => ({ a: th.a.entityId, lane: this.addLanes.indexOf(th.lane), mode: th.mode })),
      addLanes: this.addLanes.map(l => l.snapshot()), rngs: [this.rng.call.snapshot(), this.rng.charge.snapshot()] };
  }
  /** Restore from the host's reinstalled body map; no shard callback crosses this boundary. */
  restore(s: RoamingBossState<L,R>, bodies: ReadonlyMap<string,B>): void {
    const body = (id: string): B => { const b = bodies.get(id); if (b === undefined) throw new Error(`Incompatible roaming boss continuation (${id})`); return b; };
    if (s.rings.length !== this.waves.length || s.hazards.length !== this.hazardsState.length || s.addLanes.length !== this.addLanes.length || s.rngs.length !== 2) throw new Error('Incompatible roaming boss continuation');
    this.body = s.body === null ? null : body(s.body);
    Object.assign(this, { present: s.present, sealed: s.sealed, sealK: s.sealK, darkK: s.darkK, glow: s.glow, invuln: s.invuln, lockHp: s.lockHp, won: s.won,
      phase: s.phase, mode: s.mode, modeT: s.modeT, strikeCd: s.strikeCd, burstCd: s.burstCd, summonCd: s.summonCd, chain: s.chain, open: s.open });
    if(this.body!==null){
      const control=borrowedDecisionControl(this.body);
      if(s.decision===undefined){
        control.restart();
        control.fighting=this.present && ![this.row.names.idle,this.row.names.intro,this.row.names.dead].includes(this.mode);
        this.writeDecision();
      }else control.restore(s.decision);
    }
    this.lane.restore(s.lane);
    s.rings.forEach((w, i) => { const own = this.waves[i]; if (own !== undefined) Object.assign(own, w); });
    s.hazards.forEach((f, i) => { const own = this.hazardsState[i]; if (own !== undefined) Object.assign(own, f); });
    s.addLanes.forEach((l, i) => { this.addLanes[i]?.restore(l); });
    this.addsState = s.adds.map(th => {
      const lane = this.addLanes[th.lane];
      if (lane === undefined) throw new Error('Incompatible roaming boss continuation (thrall lane)');
      return { a: body(th.a), lane, mode: th.mode };
    });
    const [call, charge] = s.rngs;
    if (call !== undefined) this.rng.call.restore(call);
    if (charge !== undefined) this.rng.charge.restore(charge);
  }
}



/** Interpret the roaming rows over actual collision, charge, RNG and presentation ports. */
export function createRoamingBossFight<B extends RoamingBossBody,L,R,K extends string,A extends string,Q extends string>(row: RoamingBossRow<K,A,Q>,ports: RoamingBossPorts<B,L,R,K,A,Q>): RoamingBossFight<B,L,R> {
  class Bound extends RoamingCore<B,L,R,K,A,Q> {
    protected readonly ctx = ports;
    protected readonly tellRing = ports.views.tell;
    protected get waves() {return ports.rings();}
    protected get lane() {return ports.lane();}
    protected get addLanes() {return ports.adds.lanes();}
    protected readonly contact = ports.contact;
    constructor() {super(row,ports.random);}
    protected groundAt(x: number,z: number): number {return ports.groundAt(x,z);}
    protected makeBody(): B {return ports.body.make();}
    protected retireBody(a: B): void {ports.body.retire(a);}
    protected parkBody(a: B): void {ports.body.park(a);}
    protected unparkBody(a: B): void {ports.body.unpark(a);}
    protected spawnAdd(kind: K,x: number,z: number,yaw: number): B {return ports.adds.spawn(kind,x,z,yaw);}
    protected retireAdd(a: B): void {ports.adds.retire(a);}
    protected override onWeakPoint(p: Vector3): boolean {return ports.weakPoint(p);}
    protected override glowTo(v: number): void {ports.views.glow(v);}
    protected override hazardsHung(on: boolean): void {ports.views.hung(on);}
    protected override introFocus(a: B,out: Vector3): Vector3 {return ports.views.focus(a,out);}
    protected override room(dt: number,t: number): void {ports.views.room(dt,t);}
    protected override hazardView(i: number,f: RoamingBossHazard,t: number,event: 'drop'|'fall'|'land'|'burn'|'out'|'placed'): void {ports.views.hazard(i,f,t,event);}
    protected override addView(a: B,event: 'in'|'out'): void {ports.views.add(a,event);}
    protected override lightOn(): void {ports.views.light(true);}
    protected override lightOff(): void {ports.views.light(false);}
    protected override burstFx(a: B): void {ports.views.burst(a);}
    protected override waveView(i: number,t: number,at: Vector3|null): void {ports.views.ring(i,t,at);}
    protected action(a: B,move: A): void {ports.views.action(a,move);}
    protected roar(a: B): void {ports.views.roar(a);}
    spawn(): B {return this.spawnBody();}
    get hazards() {return this.hazardsState;}
    get adds() {return this.addsState;}
  }
  return new Bound();
}
