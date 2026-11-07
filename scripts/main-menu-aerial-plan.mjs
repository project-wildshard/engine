// Plain-Node capture launcher; sim-node-loader resolves the existing pure layout.
//   node --import scripts/sim-node-loader.mjs scripts/main-menu-aerial-plan.mjs [aerial|landscape|square|4|5|6|5x5|far]
import { aerialHeroPlan, landscapeHeroPlan, round4HeroPlan, round5HeroPlan, round6HeroPlan, squareHeroPlan, grid5x5HeroPlan, farVariantPlan } from './main-menu-aerial-poses.ts';

const round = process.argv[2] ?? 'aerial';
const plans = { aerial: aerialHeroPlan, landscape: landscapeHeroPlan, square: squareHeroPlan, 4: round4HeroPlan, 5: round5HeroPlan, 6: round6HeroPlan, '5x5': grid5x5HeroPlan, far: farVariantPlan };
if (!Object.hasOwn(plans, round)) throw new Error('Plan round must be aerial, landscape, square, 4, 5, 6, 5x5 or far');
process.stdout.write(`${JSON.stringify(plans[/** @type {keyof typeof plans} */ (round)]())}\n`);
