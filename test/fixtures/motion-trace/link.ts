import type { NetCommand } from '@wildshard/format/netCommand';
import { predictedPlayer, PredictionWorld } from '../../../src/client/engine/net/predictionWorld';
import { Predictor } from '../../../src/client/engine/net/predictor';
import { quantiseCommand } from '../../../src/shared/engine/net/command';
import { PLAYER_CLASS } from '../../../src/shared/engine/net/netSchemas';
import type { Rapier } from '../../../src/shared/engine/physics/rapier';
import { HostSide, PageSide, type MotionScenario } from './parity';

// P1-E5.3: the real Player predicting against the real PlayerSim. The server here is a tick and a queue, not a room: each
// command reaches it `delay` ticks after the client stepped it, and its owner block comes back `delay` ticks after that.

export interface LinkedTick { readonly corrected: boolean; readonly acked: number }
export interface LinkedPlayer {
  readonly page: PageSide; readonly host: HostSide;
  readonly player: PageSide['player'];
  readonly predictor: Predictor; readonly world: PredictionWorld;
  /** One tick: the client steps `input`, the link moves, the server steps what reached it, and what came back reconciles. */
  run: (input?: Partial<Pick<NetCommand, 'steer' | 'buttons' | 'yaw'>>) => LinkedTick;
  dispose: () => void;
}
const forward = { keyX: 0, keyY: 1, stickX: 0, stickY: 0 };

export function linkedPlayer(R: Rapier, scenario: MotionScenario, delay: number): LinkedPlayer {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), { player } = page, world = new PredictionWorld(page.physics);
  const predictor = new Predictor(predictedPlayer(player, world), PLAYER_CLASS.owner), up: NetCommand[][] = [], down: { tick: number; seq: number; owner: Float64Array }[][] = [];
  // a command's server tick reads the decks one tick before it ends, as the host's own step does
  const stopMovers = world.addMover({ at: (tick, replay) => { if (replay) page.course.place(tick - 1); else page.course.advance(tick - 1); } });
  let seq = 0;
  for (let at = 0; at < delay; at++) { up.push([]); down.push([]); }
  return { page, host, player, predictor, world,
    run: (input = {}) => {
      seq++;
      const command = quantiseCommand({ seq, viewTick: 0, steer: forward, yaw: scenario.start.yaw, pitch: 0, buttons: 0, ...input });
      world.poseFor(seq, false);
      page.stepWorld(); predictor.step(command);
      up.push([command]);
      const arrived: { tick: number; seq: number; owner: Float64Array }[] = [];
      for (const held of up.shift() ?? []) {
        host.course.advance(host.host.state.tick);
        host.host.step(new Map([[host.player.id, held]]));
        const owner = new Float64Array(PLAYER_CLASS.owner.length);
        PLAYER_CLASS.owner.forEach((column, index) => { owner[index] = column.sample(host.player, () => 0); });
        arrived.push({ tick: host.host.state.tick, seq: held.seq, owner });
      }
      down.push(arrived);
      let corrected = false, acked = 0;
      for (const frame of down.shift() ?? []) {
        world.frame(frame.tick, frame.seq);
        corrected = predictor.reconcile(frame.seq, frame.owner) || corrected;
        acked = frame.seq;
      }
      return { corrected, acked };
    },
    dispose: () => { stopMovers(); world.dispose(); page.dispose(); host.dispose(); } };
}
