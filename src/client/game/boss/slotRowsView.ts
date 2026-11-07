/** A slot encounter on the wire (FLIP-7): the server runs the law, and this draws what its rows say. Which sites stand empty is a world
 *  row, and every cue and tell a page's own law played comes from each body's row: its health, its strike, its rise. */
import * as THREE from 'three';
import type { SlotViewRows } from '@wildshard/format/encounterRows';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { slotAwakeRows } from '../../../shared/game/boss/slotLaw';
import type { ReturnProgram } from '../../../shared/game/population/returnProgram';
import type { CueDirector } from '../audio/cueDirector';
import type { GroundTell } from '../eliteView';
import type { EncounterSites } from './encounterView';

const UP = new THREE.Vector3(0, 1, 0), point = new THREE.Vector3();
/** One body the rows have out. */
interface Out { lastHp: number; wedge: GroundTell | null; dead: boolean; struck: boolean; told: boolean }
/** What a row view borrows. */
export interface SlotRowsPorts { readonly cues: Pick<CueDirector, 'cue'>; readonly guest: Pick<ReturnProgram, 'project'>; readonly row: (name: string) => number | undefined; readonly cosmetic: () => number; readonly drew: (what: string) => void }

export class SlotRowsView {
  private readonly awakeRows;
  private readonly awake: boolean[];
  private readonly wanted: boolean[];
  private readonly out = new Map<Animal, Out>();
  /** A world's first rows say where things stand: nothing wakes in them. */
  private seen = false;
  private trailT = 0;
  constructor(private readonly kind: string, private readonly rows: SlotViewRows, private readonly sites: Pick<EncounterSites, 'sites' | 'apply'>, private readonly tells: readonly GroundTell[], private readonly ports: SlotRowsPorts) {
    this.awakeRows = slotAwakeRows(sites.sites.length);
    this.awake = sites.sites.map(() => false); this.wanted = sites.sites.map(() => false);
  }
  /** Whether a site's statue stands empty now. */
  isAwake(index: number): boolean { return this.awake[index] === true; }
  private follow(): void {
    const { awake, wanted, sites, rows, ports } = this;
    this.awakeRows.awake(ports.row, wanted);
    for (const [index, now] of wanted.entries()) {
      if (awake[index] === now) continue;
      awake[index] = now; sites.apply([{ index, awake: Number(now) }]);
      const site = sites.sites[index];
      if (now && this.seen && site !== undefined) ports.cues.cue(rows.cues.wake, point.set(site.x, heightAt(site.x, site.z) + rows.lift.wake, site.z), UP);
    }
    this.seen ||= this.awakeRows.heard(ports.row);
  }
  private free(): GroundTell | null {
    const taken = new Set([...this.out.values()].map(row => row.wedge));
    return this.tells.find(tell => !taken.has(tell)) ?? null;
  }
  private strike(a: Animal, reach: number): void {
    const { rows, ports } = this;
    point.set(a.position.x + Math.sin(a.yaw) * reach * rows.strike.ahead, 0, a.position.z + Math.cos(a.yaw) * reach * rows.strike.ahead);
    ports.cues.cue(rows.cues.strike, point.setY(heightAt(point.x, point.z) + rows.lift.strike), UP);
  }
  /** One body's cues and tell, as `SlotEncounterLaw.update` plays them. */
  private body(a: Animal, member: Out, trail: boolean): void {
    const { rows, ports } = this, sc = a.scale;
    if (a.hp < member.lastHp) {
      point.set(a.position.x, a.position.y + rows.lift.hit * sc, a.position.z);
      const weak = ports.guest.project('weakPoint', { x: a.position.x, ay: a.position.y, z: a.position.z, cos: Math.cos(-a.yaw), sin: Math.sin(-a.yaw), scale: a.scale, yOffset: a.yOffset, hitX: point.x, hitY: point.y, hitZ: point.z })['weakPoint'] === 1;
      ports.cues.cue(weak ? rows.cues.weak : a.hp < member.lastHp - rows.cues.hard.drop ? rows.cues.hard.cue : rows.cues.hit, point, UP);
    }
    member.lastHp = a.hp;
    if (!a.alive) {
      member.wedge?.hide();
      if (!member.dead) ports.cues.cue(rows.cues.broken, point.set(a.position.x, a.position.y + rows.lift.broken * sc, a.position.z), UP);
      member.dead = true;
      return;
    }
    if (trail) for (const row of rows.trails) {
      const value = a.mem[row.field] ?? 0;
      if (value < row.min || value >= row.max || (row.chance < 1 && ports.cosmetic() >= row.chance)) continue;
      ports.cues.cue(row.cue, point.set(a.position.x, row.at === 'ground' ? heightAt(a.position.x, a.position.z) + row.lift : a.position.y + row.lift * sc, a.position.z), UP);
    }
    const p = a.attackPhase, tell = rows.tell, reach = tell.reach * sc, { wedge } = member;
    if (p < 0) { wedge?.hide(); member.struck = false; member.told = false; return; }
    if (p < tell.strike + tell.hold) {
      wedge?.wedge(a.position.x, a.position.z, a.yaw, reach, Math.min(1, p / tell.wind), p < tell.strike ? tell.alpha[0] + tell.alpha[1] * (p / tell.wind) : tell.alpha[2]);
      if (wedge !== null && !member.told) { member.told = true; ports.drew('wedge'); }
    } else wedge?.hide();
    if (p >= tell.strike && !member.struck) { member.struck = true; this.strike(a, reach); }
  }
  /** One frame's rows. `animals` are the bodies on this page. */
  update(dt: number, animals: readonly Animal[]): void {
    this.follow();
    this.trailT += dt;
    const trail = this.trailT > this.rows.every;
    if (trail) this.trailT = 0;
    for (const [body, member] of this.out) if (!animals.includes(body)) { member.wedge?.hide(); this.out.delete(body); }
    for (const body of animals) {
      if (body.kind !== this.kind) continue;
      let member = this.out.get(body);
      if (member === undefined) { member = { lastHp: body.hp, wedge: this.free(), dead: !body.alive, struck: false, told: false }; this.out.set(body, member); }
      this.body(body, member, trail);
    }
  }
}
