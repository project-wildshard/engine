import { Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import { flightPoint } from '@wildshard/engine/combat/projectileFlight';
import type { NetFlight, NetVector } from '@wildshard/engine/net/messages';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';

/** The server's fixed step: a flight's `tick` counts these. */
const STEP = 1 / 60;
/** A flight no hit or ground ended in this long is dropped. */
const LONGEST = 10;
/** A hit this near a flight's point ended it. */
const STRUCK = 1.5;
const BALL = new SphereGeometry(0.15, 8, 6), PAINT = new MeshBasicMaterial({ color: 0xffb347 });

/**
 * ONE-FORMAT CC18c: the projectiles one scene flies, each from its `flight` event by the server's law (`flightPoint`), so two
 * pages draw one flight at one place. A flight ends at the ground, at a hit beside it, or after `LONGEST` seconds.
 */
export class StrikeFlights {
  private readonly live: NetFlight[] = [];
  private readonly balls: Mesh[] = [];
  private readonly point = new Vector3();
  private readonly scene: Object3D;
  constructor(scene: Object3D) {
    this.scene = scene;}
  add(flight: NetFlight): void { this.live.push(flight); }
  /** A crossing: every flight belonged to the cell left. */
  clear(): void { this.live.length = 0; this.show(0); }
  /** A hit at `at` on `tick` ends the flight nearest it there, if one is within `STRUCK`. */
  struck(at: NetVector, tick: number): void {
    let best = -1, near = STRUCK * STRUCK;
    for (const [index, flight] of this.live.entries()) {
      const { x, y, z } = this.at(flight, tick), d = (x - at[0]) ** 2 + (y - at[1]) ** 2 + (z - at[2]) ** 2;
      if (tick >= flight.tick && d < near) { near = d; best = index; }
    }
    if (best >= 0) this.live.splice(best, 1);
  }
  /** Where `flight` stands at a (fractional) server tick: the server launched it before that tick's own flight step. */
  at(flight: NetFlight, tick: number): Vector3 {
    const [x, y, z] = flight.at, [dx, dy, dz] = flight.dir;
    return flightPoint({ x, y, z }, { x: dx, y: dy, z: dz }, flight.speed, flight.gravity, STEP, tick - flight.tick + 1, this.point);
  }
  /** Places a ball on each flight at `tick` and returns how many it drew; one launched after `tick` waits. */
  show(tick: number): number {
    let used = 0;
    for (let index = this.live.length - 1; index >= 0; index--) {
      const flight = this.live[index];
      if (flight === undefined || tick < flight.tick) continue;
      const { x, y, z } = this.at(flight, tick);
      if ((tick - flight.tick) * STEP > LONGEST || y < terrainHeight(x, z)) { this.live.splice(index, 1); continue; }
      let ball = this.balls[used];
      if (ball === undefined) { ball = new Mesh(BALL, PAINT); this.balls.push(ball); this.scene.add(ball); }
      ball.position.set(x, y, z); ball.visible = true; used++;
    }
    for (let index = used; index < this.balls.length; index++) { const ball = this.balls[index]; if (ball !== undefined) ball.visible = false; }
    return used;
  }
}
