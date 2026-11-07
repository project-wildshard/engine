/** Render-free visitor flight, feeding and perch poses driven entirely by flock rows. */
import { Rng } from '@wildshard/engine/core/rng';
import { CirclingFlyer } from '@wildshard/engine/ai/ambientFlight';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { AmbientFlock, type AmbientFlockBird,type AmbientFlockCall,type AmbientFlockPlayer,type AmbientPerch } from '@wildshard/engine/ai/ambientFlock';
import { parseAmbientFlock, parseAmbientPerches, type AmbientFlockData } from '@wildshard/format/ambientLife';

interface Point {x:number;y:number;z:number}
type AmbientVisitorState=0|7|8|9|10;
interface AmbientVisitorBird extends Omit<AmbientFlockBird,'state'> {
  state:AmbientVisitorState;next:AmbientVisitorState;site:number;ox:number;oz:number;orad:number;oalt:number;ow:number;oph:number;pecks:number;peckT:number;
  sx:number;sy:number;sz:number;syaw:number;hx:number;hz:number;hopT:number;hopDur:number;gy:number;act:number;
}
interface AmbientVisitorPerch extends AmbientPerch {readonly r?:number;readonly w?:number}
export interface AmbientVisitorPlayer extends AmbientFlockPlayer {
  readonly fast?:boolean;readonly light?:number;readonly fx?:number;readonly fz?:number;readonly toward?:{readonly x:number;readonly z:number}|null;
  readonly weather?:Readonly<Record<string,number>>;
}
type AmbientSiteVisit=0|1|2|3;
interface Site { x: number; z: number; width: number; visit: AmbientSiteVisit; feedLeft: number; leaveT: number; open: boolean }
const HIDDEN=0,FLY=7,CIRCLE=8,FEED=9,VISIT=10,TAU=Math.PI*2;
const wrap=(a:number):number=>Math.atan2(Math.sin(a),Math.cos(a));
const toward=(v:number,to:number,rate:number,dt:number):number=>v+(to-v)*Math.min(1,dt*rate);
class AmbientVisitors {
  readonly birds:AmbientVisitorBird[]=[];
  readonly calls:AmbientFlockCall[]=[];
  private readonly rng:Rng;
  private readonly flight:CirclingFlyer;
  private readonly pool:AmbientFlockCall[]=Array.from({length:8},()=>({x:0,y:0,z:0,cue:'',gain:1}));
  private readonly sites:Site[]=[];
  private voiceT=0;private flapT=0;private visitT=0;private time=0;
  private readonly mine:AmbientVisitorBird[]=[];
  private readonly ground:[number,number]=[0,0];
  private readonly p:Point={x:0,y:0,z:0};
  constructor(readonly row:AmbientFlockData,private readonly perches:readonly AmbientVisitorPerch[]=[]){
    if(row.wheeling!==null||row.perch!==null||row.guide!==null)throw new Error('Visitor flight cannot mix wheeling, perch or guide policies');
    const rng=this.rng=new Rng(row.seed);
    this.flight=new CirclingFlyer(row.flight,undefined,row.wingbeats);
    // Preserve the original perch-facing and shuffle draws before bird phases.
    for(let i=0;i<4096;i++){if(i>=perches.length)break;rng.range(0,TAU);}
    for(let k=0;k<4096;k++){const i=perches.length-1-k;if(i<=0)break;rng.int(0,i);}
    for(let i=0;i<256;i++){
      if(i>=row.count)break;
      const b: AmbientVisitorBird = {
        state: HIDDEN, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flap: 0.12, fold: 0, head: 0, legs: 1, peck: 0, body: 0,
        next: HIDDEN, site: -1, ox: 0, oz: 0, orad: 8, oalt: 12, ow: 0.5, oph: 0, pecks: 0, peckT: 0, sx: 0, sy: 0, sz: 0, syaw: 0, hx: 0, hz: 0, hopT: 1, hopDur: 0, gy: 0, act: 0,
        perch: -1, loop: { cx:0,cz:0,r:1,alt:0,w:0,p1:0,p2:0,p3:0,p4:0 }, phase: rng.range(0, 6.28), scale: 1, altOff: 0,
        t: 0, dur: 1, timer: 0, flush: 0,
        flapT: 0, burst: 0, glide: rng.range(1, 4), headFrom: 0, headTo: 0, headT: 1, headDur: 1,
        ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, tx: 0, ty: 0, tz: 0, yaw0: 0, call: false,
      };
      this.birds.push(b);
    }
  }
  private wings(b: AmbientVisitorBird, dt: number): void { [b.flap, b.fold] = this.flight.burst(b, dt, b.flap, b.fold, this.row.wingbeat, this.rng, true); }
  private call(x: number, y: number, z: number, cue = this.row.call?.cue, gain = 1): void {
    const c = this.pool[this.calls.length];
    if (c === undefined || cue === undefined) return;
    c.x = x; c.y = y; c.z = z; c.cue = cue; c.gain = gain; this.calls.push(c);
  }
  private bez(b: AmbientVisitorBird, cx: number, cy: number, cz: number, u: number, out: Point): Point {
    const v = 1 - u, w0 = v * v, w1 = 2 * v * u, w2 = u * u;
    out.x = b.ax * w0 + b.bx * w1 + cx * w2; out.y = b.ay * w0 + b.by * w1 + cy * w2; out.z = b.az * w0 + b.bz * w1 + cz * w2;
    return out;
  }
  private move(b: AmbientVisitorBird, to: Point, dt: number, bank: number): void {
    this.flight.face(b, to.x - b.x, to.y - b.y, to.z - b.z, dt, bank); b.x = to.x; b.y = to.y; b.z = to.z;
  }

  update(dt:number,player:AmbientVisitorPlayer):void {
    this.calls.length=0;if(dt<=0)return;this.time+=dt;
    for(let i=0;i<256;i++){const b=this.birds[i];if(b===undefined)break;switch(b.state){
      case FLY:this.stepFly(b,dt);break;
      case CIRCLE:this.stepCircle(b,dt);break;
      case FEED:this.stepFeed(b,dt);break;
      case VISIT:this.stepVisit(b,dt,player);break;
      case HIDDEN:if(this.row.visit!==null)this.tryVisit(b,player);break;
      default:break;
    }}
    if(this.row.scavenge!==null)this.stepSites(dt,player);
  }
  // ── the scavenge and visit modes ──
  /** fly from where it is to (x, y, z) at `speed` m/s, bowing along its heading and up by `lift`; `next` on arrival */
  private flyTo(b: AmbientVisitorBird, x: number, y: number, z: number, speed: number, lift: number, next: AmbientVisitorState): void {
    const d = Math.hypot(x - b.x, y - b.y, z - b.z), lead = b.state === FLY || b.state === CIRCLE ? d * 0.35 : d * 0.12;
    b.ax = b.x; b.ay = b.y; b.az = b.z;
    b.bx = (b.x + x) / 4 + (b.x + Math.sin(b.yaw) * lead) / 2; b.bz = (b.z + z) / 4 + (b.z + Math.cos(b.yaw) * lead) / 2; b.by = Math.max(b.y, y) + lift;
    b.tx = x; b.ty = y; b.tz = z; b.t = 0; b.dur = Math.max(0.8, d / speed); b.next = next; b.state = FLY;
  }
  /** appear at (x, y, z) already flying, heading for (tx, tz) */
  private spawnAt(b: AmbientVisitorBird, x: number, y: number, z: number, tx: number, tz: number): void {
    b.x = x; b.y = y; b.z = z; b.yaw = Math.atan2(tx - x, tz - z); b.pitch = 0; b.roll = 0;
    b.fold = 0; b.legs = 1; b.body = 0; b.head = 0; b.peck = 0; b.burst = 4; b.flapT = 0;
  }
  /** a croak (two trading croaks when `pair`): one at a time across the flock, `voices.gap` apart */
  private caw(b: AmbientVisitorBird, pair = false): void {
    const v = this.row.scavenge?.voices;
    if (v === undefined || this.time < this.voiceT) return;
    this.voiceT = this.time + this.rng.range(...v.gap);
    this.call(b.x, b.y, b.z, pair ? v.pair : v.call, v.gain);
  }
  /** wings clattering up (one for a flock going up together) */
  private flapCall(b: AmbientVisitorBird): void {
    const v = this.row.scavenge?.voices;
    if (v === undefined || this.time < this.flapT) return;
    this.flapT = this.time + v.flapGap; this.call(b.x, b.y, b.z, v.flap, v.flapGain);
  }
  private stepFly(b: AmbientVisitorBird, dt: number): void {
    b.t += dt;
    const u = Math.min(1, b.t / b.dur), p = this.bez(b, b.tx, b.ty, b.tz, u * u * (3 - 2 * u) * 0.3 + u * 0.7, this.p);
    const sag = this.row.visit?.sag ?? 0;
    if (sag > 0 && b.burst === 0) p.y -= sag * Math.sin(Math.min(1, 1 - b.glide / 0.3) * Math.PI); // a bounding flight sags in each glide
    this.move(b, p, dt, this.row.flight.bank);
    b.legs = toward(b.legs, 1, 3, dt); this.wings(b, dt);
    if (u < 1) return;
    const site = this.sites[b.site], sc = this.row.scavenge, vi = this.row.visit;
    if (b.next === CIRCLE && site !== undefined) this.circleOver(b, site, b.act === 1);
    else if (b.next === FEED && sc !== null) { b.state = FEED; b.timer = this.rng.range(...sc.land.pause); b.pecks = 0; b.pitch = sc.land.pitch; b.roll = 0; b.legs = 0; b.hopT = 1; }
    else if (b.next === VISIT && vi !== null) {
      b.state = VISIT; b.x = b.sx; b.y = b.sy; b.z = b.sz; if (b.syaw !== Infinity) b.yaw = b.syaw;
      b.pitch = vi.pose.pitch; b.roll = 0; b.legs = vi.pose.legs; b.body = vi.pose.body; b.timer = vi.acts === null ? 0 : this.rng.range(...vi.acts.first); b.act = 0;
      b.peckT = this.time + (vi.call === null ? 0 : this.rng.range(...vi.call.first));
    } else { b.state = HIDDEN; b.site = -1; }
  }

  /** Borrow up to `n` hidden birds to a site at (x, z) whose body is `width` m across; its id, or -1 (none free). */
  gather(x: number, z: number, width: number, n: number): number {
    const sc = this.row.scavenge;
    if (sc === null || this.sites.length >= 4096) return -1;
    const free = this.birds.filter((b) => b.state === HIDDEN).slice(0, n);
    if (free.length === 0) return -1;
    const id = this.sites.length, gy = terrainHeight(x, z), a = sc.arrive;
    this.sites.push({ x, z, width, visit: 1, feedLeft: this.rng.range(...sc.feed.time), leaveT: this.time + sc.feed.leave, open: true });
    for (let i=0;i<256;i++) {
      const b=free[i];if(b===undefined)break;
      const ang = this.rng.range(0, TAU), far = this.rng.range(...a.far);
      b.site = id; b.act = 0;
      this.spawnAt(b, x + Math.cos(ang) * far, gy + this.rng.range(...a.up), z + Math.sin(ang) * far, x, z);
      this.flyTo(b, x + Math.cos(ang) * a.near, gy + a.height, z + Math.sin(ang) * a.near, a.speed, a.lift, CIRCLE);
    }
    const lead = free[0];
    if (lead) this.caw(lead, free.length > 1); // they announce themselves coming in
    return id;
  }
  /** a site's visit (gone 3 once its birds have left, or for an unknown id) */
  siteVisit(id: number): AmbientSiteVisit { return this.sites[id]?.visit ?? 3; }
  /** the site's birds leave now (the body is gone) */
  release(id: number, player: Point): void {
    const s = this.sites[id];
    if (s === undefined || !s.open) return;
    for (let i=0;i<256;i++){const b=this.birds[i];if(b===undefined)break;if(b.site===id&&b.state!==HIDDEN)this.depart(b,player);}
    s.open = false; s.visit = 3;
  }
  private groundSpot(s: Site, i: number, n: number, ring: readonly [number, number]): [number, number] {
    const ang = (i / n) * TAU + this.rng.range(-0.5, 0.5), r = s.width + this.rng.range(...ring);
    this.ground[0]=s.x+Math.cos(ang)*r;this.ground[1]=s.z+Math.sin(ang)*r;return this.ground;
  }
  private circleOver(b: AmbientVisitorBird, s: Site, high: boolean): void {
    const c = this.row.scavenge?.circle;
    if (c === undefined) return;
    b.state = CIRCLE; b.ox = s.x; b.oz = s.z; b.orad = this.rng.range(...c.radius);
    b.oalt = terrainHeight(s.x, s.z) + this.rng.range(...(high ? c.high : c.low));
    b.ow = this.rng.range(...c.speed) * (this.rng.next() < 0.5 ? -1 : 1); b.oph = Math.atan2(b.z - b.oz, b.x - b.ox);
    b.timer = this.rng.range(...c.timer);
  }
  private stepCircle(b: AmbientVisitorBird, dt: number): void {
    const c = this.row.scavenge?.circle;
    if (c === undefined) return;
    this.flight.step(b, b, dt); b.timer -= dt; b.legs = 1;
    // soaring: mostly held wings, the odd few beats
    if (b.burst > 0 || this.rng.next() < dt * c.beat) this.wings(b, dt);
    else { b.flap = toward(b.flap, 0.1, 4, dt); b.fold = toward(b.fold, 0, 4, dt); }
    if (this.rng.next() < dt * c.call) this.caw(b, this.rng.next() < 0.35); // a croak from overhead now and then
  }
  private stepFeed(b: AmbientVisitorBird, dt: number): void {
    const sc = this.row.scavenge, s = this.sites[b.site];
    if (sc === null) return;
    const f = sc.feed;
    if (s !== undefined) b.yaw += wrap(Math.atan2(s.x - b.x, s.z - b.z) - b.yaw) * Math.min(1, dt * 3);
    b.flap = toward(b.flap, f.wings[0], 6, dt); b.fold = toward(b.fold, f.wings[1], 6, dt); b.legs = toward(b.legs, 0, 8, dt);
    b.timer -= dt;
    if (b.pecks > 0) {
      b.peckT += dt * f.rate;
      b.peck = f.peck[0] + f.peck[1] * Math.max(0, Math.sin(b.peckT * Math.PI));
      b.head = toward(b.head, 0, 6, dt);
      if (b.peckT >= 1) { b.peckT = 0; b.pecks--; }
    } else {
      b.peck = toward(b.peck, f.peck[2], 5, dt);
      this.lookAbout(b, dt, f.look[0], f.look[1]);
      if (b.timer <= 0) {
        b.timer = this.rng.range(...f.pause);
        if (this.rng.next() < f.squabble) this.caw(b, true); // squabbling over the kill
        if (this.rng.next() < f.hop && s !== undefined) { // a hop (a flick of the wings)
          const [x, z] = this.groundSpot(s, this.rng.int(0, 5), 6, sc.land.ring);
          b.ax = b.x; b.az = b.z; b.hx = x; b.hz = z; b.hopT = 0; b.hopDur = f.hopTime; b.burst = 1;
        } else { b.pecks = this.rng.int(...f.pecks); b.peckT = 0; }
      }
    }
    if (b.hopT < 1) {
      b.hopT = Math.min(1, b.hopT + dt / b.hopDur);
      const u = b.hopT;
      b.x = b.ax + (b.hx - b.ax) * u; b.z = b.az + (b.hz - b.az) * u; b.y = terrainHeight(b.x, b.z) + sc.land.stand + Math.sin(u * Math.PI) * f.hopHeight;
      if (b.burst > 0) { b.fold = 0.3; b.flap = Math.sin(u * TAU) * 0.6; }
      if (u >= 1) b.burst = 0;
    } else b.y = terrainHeight(b.x, b.z) + sc.land.stand;
  }
  /** fly off away from the player, out of sight, then hidden */
  private depart(b: AmbientVisitorBird, player: Point): void {
    const d = this.row.scavenge?.depart ?? this.row.visit?.depart;
    if (d === undefined) { b.state = HIDDEN; return; }
    const ang = Math.atan2(b.z - player.z, b.x - player.x) + this.rng.range(-d.spread, d.spread);
    if (b.state === FEED) { b.legs = 0; b.burst = 6; this.flapCall(b); }
    b.body = 0; b.site = -1;
    this.flyTo(b, b.x + Math.cos(ang) * d.distance, b.y + this.rng.range(...d.up), b.z + Math.sin(ang) * d.distance, d.speed, d.lift, HIDDEN);
  }
  private stepSites(dt: number, player: AmbientVisitorPlayer): void {
    const sc = this.row.scavenge;
    if (sc === null) return;
    const flushAt = player.fast === true ? sc.flush[1] : sc.flush[0];
    for(let id=0;id<4096;id++){
      const s=this.sites[id];if(s===undefined)break;
      if(!s.open)continue;
      const mine=this.mine;mine.length=0;
      let near=Infinity,feeding=false;
      for(let i=0;i<256;i++){
        const b=this.birds[i];if(b===undefined)break;if(b.site!==id)continue;
        mine.push(b);near=Math.min(near,Math.hypot(b.x-player.x,b.z-player.z));feeding ||= b.state===FEED;
      }
      if(mine.length===0){s.open=false;s.visit=3;continue;}
      const dist=Math.hypot(s.x-player.x,s.z-player.z);
      for(let k=0;k<256;k++){
        const b=mine[k];if(b===undefined)break;
        if (b.state === FEED) {
          if (near >= flushAt) continue;
          const l = sc.lift; b.legs = 0; b.burst = 7; b.act = 1;
          this.flyTo(b, b.x + this.rng.range(-l.side, l.side), b.y + this.rng.range(...l.up), b.z + this.rng.range(-l.side, l.side), l.speed, l.lift, CIRCLE);
          this.flapCall(b); this.caw(b);
        } else if (b.state === CIRCLE && dist > sc.feed.reland && b.timer <= 0 && this.time < s.leaveT) {
          const [x, z] = this.groundSpot(s, k, mine.length, sc.land.ring);
          b.act = 0; this.flyTo(b, x, terrainHeight(x, z) + sc.land.stand, z, sc.land.speed, sc.land.lift, FEED);
        }
      }
      s.visit = feeding ? 2 : 1;
      if (feeding) s.feedLeft -= dt;
      if(s.feedLeft<=0||this.time>s.leaveT){for(let i=0;i<256;i++){const b=mine[i];if(b===undefined)break;this.depart(b,player);}s.open=false;s.visit=3;}
    }
  }

  private lookAbout(b: AmbientVisitorBird, dt: number, range: number, rate: number): void {
    if (this.rng.next() < dt * rate) b.headTo = this.rng.range(-range, range);
    b.head = toward(b.head, b.headTo, 7, dt);
  }
  /** the best perch `rMin`..`rMax` from (x, z), its weight `w`, facing `to` when given (null: none) */
  private pickPerch(x: number, z: number, rMin: number, rMax: number, to: { readonly x: number; readonly z: number } | null | undefined): AmbientVisitorPerch | null {
    let best: AmbientVisitorPerch | null = null, bs = 0;
    for (let i=0;i<4096;i++){
      const p=this.perches[i];if(p===undefined)break;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < rMin || d > rMax) continue;
      const aim = to ? Math.max(0.1, ((p.x - x) * (to.x - x) + (p.z - z) * (to.z - z)) / (d * Math.hypot(to.x - x, to.z - z) || 1) + 1) : 1;
      const score = (p.w ?? 1) * aim * (0.6 + this.rng.next() * 0.8);
      if (score > bs) { bs = score; best = p; }
    }
    return best;
  }
  /** fly to a perch: on a trunk, onto its bark on the side toward the player, facing it */
  private settle(b: AmbientVisitorBird, p: AmbientVisitorPerch, player: Point): void {
    const vi = this.row.visit;
    if (vi === null) return;
    if (p.r === undefined) { b.sx = p.x; b.sy = p.y + vi.pose.stand; b.sz = p.z; b.syaw = Infinity; this.flyTo(b, b.sx, b.sy, b.sz, vi.speed, vi.lift, VISIT); return; }
    const ang = Math.atan2(player.z - p.z, player.x - p.x) + this.rng.range(-vi.cling, vi.cling), rad = p.r + 0.05;
    b.sx = p.x + Math.cos(ang) * rad; b.sy = p.y; b.sz = p.z + Math.sin(ang) * rad; b.syaw = Math.atan2(-Math.cos(ang), -Math.sin(ang));
    this.flyTo(b, b.sx - Math.sin(b.syaw) * vi.approach[0], b.sy - vi.approach[1], b.sz - Math.cos(b.syaw) * vi.approach[0], vi.speed, vi.lift, VISIT);
  }
  private arriveFrom(b: AmbientVisitorBird, p: AmbientVisitorPerch, player: AmbientVisitorPlayer): void {
    const f = this.row.visit?.from;
    if (f === undefined) return;
    if (f.kind === 'behind') { const x = player.x - (player.fx ?? 0) * f.back, z = player.z - (player.fz ?? 1) * f.back; this.spawnAt(b, x, terrainHeight(x, z) + f.up, z, p.x, p.z); }
    else this.spawnAt(b, p.x + (p.x - player.x) * f.back, p.y + f.up, p.z + (p.z - player.z) * f.back, p.x, p.z);
    this.settle(b, p, player);
  }
  private tryVisit(b: AmbientVisitorBird, player: AmbientVisitorPlayer): void {
    const vi = this.row.visit, light = player.light ?? 0;
    if (vi === null || light < vi.enter[0] || light > vi.enter[1] || this.time < this.visitT) return;
    this.visitT = this.time + vi.every;
    const p = this.pickPerch(player.x, player.z, vi.near[0], vi.near[1], null);
    if (p !== null) this.arriveFrom(b, p, player);
  }
  /** The visitor out now onto the perch nearest (x, z) within `reach`, from behind `player`; false: no perch there. */
  visitAt(x: number, z: number, reach: number, player: AmbientVisitorPlayer): boolean {
    const b = this.birds[0], p = this.pickPerch(x, z, 0, reach, null);
    if (b === undefined || p === null) return false;
    this.arriveFrom(b, p, player);
    return true;
  }
  /** Send the visitor away now; it comes back on the next try (captures). */
  visitSoon(): void { const b = this.birds[0]; if (b) b.state = HIDDEN; this.visitT = 0; }
  private stepVisit(b: AmbientVisitorBird, dt: number, player: AmbientVisitorPlayer): void {
    const vi = this.row.visit;
    if (vi === null) return;
    const d = Math.hypot(b.x - player.x, b.z - player.z), light = player.light ?? 0, acts = vi.acts;
    // the stare: the head follows you (most of the way round), the body faces off
    if (vi.stare > 0 && d < vi.stare) { b.headTo = Math.max(-vi.stareTurn, Math.min(vi.stareTurn, wrap(Math.atan2(player.x - b.x, player.z - b.z) - b.yaw))); b.head = toward(b.head, b.headTo, 2.5, dt); }
    else if (b.act <= 0) this.lookAbout(b, dt, vi.look[0], vi.look[1]);
    b.flap = toward(b.flap, -0.05, 6, dt); b.fold = toward(b.fold, 1, 6, dt);
    b.timer -= dt;
    const drum = acts?.drum ?? null;
    if (drum !== null && b.act > 0) { // the drum roll: knocks at `rate` a second, the head a blur against the trunk
      b.act -= dt; b.hopT += dt * drum.rate;
      b.peck = drum.peck[0] + drum.peck[1] * Math.abs(Math.sin(b.hopT * Math.PI));
    } else {
      b.peck = vi.sway > 0 ? vi.pose.peck + Math.sin(this.time * 0.7) * vi.sway : toward(b.peck, vi.pose.peck, 6, dt);
      if (acts !== null && b.timer <= 0) {
        b.timer = this.rng.range(...acts.every);
        const r = this.rng.next();
        if (r < acts.hitch[0]) b.y += acts.hitch[1]; // hitches up the trunk
        else if (r < acts.hitch[0] + acts.call) { if (d < vi.within && vi.callCue !== null) this.call(b.x, b.y, b.z, vi.callCue, vi.gain); }
        else if (drum !== null) {
          b.act = this.rng.range(...drum.length); b.hopT = 0;
          if (d < drum.within) { this.call(b.x, b.y, b.z, drum.cue, vi.gain); b.act = drum.voiced; }
        }
      }
    }
    const call = vi.call;
    if (call !== null && this.time >= b.peckT) { b.peckT = this.time + this.rng.range(...call.every); if (d < call.within) this.call(b.x, b.y, b.z, call.cue, vi.gain); }
    if (light < vi.stay[0] || light > vi.stay[1] || d > vi.leave) { b.burst = 3; b.pitch = 0; this.depart(b, player); this.visitT = this.time + vi.leaveWait; return; }
    if (d < vi.flush) { // flushed: on to another perch (toward where the player has not been), else away
      b.burst = 3; b.body = 0; b.pitch = 0; b.legs = vi.flushLegs;
      if (vi.callCue !== null && vi.flushCall) this.call(b.x, b.y, b.z, vi.callCue, vi.gain);
      const p = this.pickPerch(b.x, b.z, vi.relocate[0], vi.relocate[1], vi.aim ? player.toward : null);
      if (p !== null) this.settle(b, p, player); else { this.depart(b, player); this.visitT = this.time + vi.leaveWait; }
    }
  }

}

/** One admitted ambient group: the engine owns wheel/guide flight; visitor rows
 * add perch arrivals, feeding and flee poses. Inputs are plain rows and numeric
 * perches; terrain comes from the installed engine field, never a shard hook.
 * This host is render-free. The client may pack these poses into its existing
 * instanced draw. Carcass selection, harvest rewards and story stay outside. */
export class AmbientGroup {
  readonly row: AmbientFlockData;
  private readonly motion: AmbientFlock | AmbientVisitors;
  private active: boolean;
  private readonly parked: readonly never[] = [];
  private readonly weatherGates: readonly (readonly [string, readonly [number, number]])[];
  constructor(input: unknown, perches: unknown = []) {
    this.row = parseAmbientFlock(input);
    this.active = this.row.when === undefined;
    const sites = parseAmbientPerches(perches);
    this.weatherGates = Object.entries(this.row.when?.weather ?? {});
    this.motion = this.row.visit !== null || this.row.scavenge !== null
      ? new AmbientVisitors(this.row, sites) : new AmbientFlock(this.row, sites);
  }
  get birds(): readonly (AmbientFlockBird | AmbientVisitorBird)[] { return this.active ? this.motion.birds : this.parked; }
  get calls(): readonly AmbientFlockCall[] { return this.active ? this.motion.calls : this.parked; }
  /** Inactive presentation groups park their clock and publish no poses or cues. */
  update(dt: number, player: AmbientVisitorPlayer): void {
    const gate = this.row.when, light = player.light ?? 0;
    this.active = gate?.light === undefined || (light >= gate.light[0] && light <= gate.light[1]);
    for (const [name, bounds] of this.weatherGates) {
      const value = player.weather?.[name];
      this.active &&= value !== undefined && Number.isFinite(value) && value >= bounds[0] && value <= bounds[1];
    }
    if (this.active) this.motion.update(dt, player);
  }
  guide(player: Point, x: number, z: number): boolean { return this.motion instanceof AmbientFlock && this.motion.guide(player, x, z); }
  gather(x: number, z: number, width: number, count: number): number { return this.motion instanceof AmbientVisitors ? this.motion.gather(x, z, width, count) : -1; }
  siteVisit(id: number): AmbientSiteVisit { return this.motion instanceof AmbientVisitors ? this.motion.siteVisit(id) : 3; }
  release(id: number, player: Point): void { if (this.motion instanceof AmbientVisitors) this.motion.release(id, player); }
  visitAt(x: number, z: number, reach: number, player: AmbientVisitorPlayer): boolean { return this.motion instanceof AmbientVisitors && this.motion.visitAt(x, z, reach, player); }
  visitSoon(): void { if (this.motion instanceof AmbientVisitors) this.motion.visitSoon(); }
}
