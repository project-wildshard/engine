import {expect,it} from 'vitest';
import {zeroPolicyFailures,customSectionsZeroFailures} from '../scripts/check-custom-sections-zero.mjs';

const zero={'custom-sections/total':0};
it('admits a complete zero census and locks the only custom budget to zero',()=>{
  expect(customSectionsZeroFailures(zero,{a:{customSections:[],customSectionBytes:0}})).toEqual([]);
});
it.each([{}, {'custom-sections/total':1},{'custom-sections/total':-1},{'custom-sections/total':'0'}])('refuses missing or altered zero policy %j',budgets=>{
  expect(zeroPolicyFailures(budgets).length).toBeGreaterThan(0);
});
it('cannot restore per-shard capacity, even at zero',()=>{
  expect(zeroPolicyFailures({...zero,'custom-sections/a/count':0})).toEqual(['Retired custom-section ceiling: custom-sections/a/count']);
});
it.each(['custom/example','world/private.json'])('refuses every charged identity, including %s',name=>{
  expect(customSectionsZeroFailures(zero,{a:{customSections:[{name,bytes:7}],customSectionBytes:7}})).toEqual([`a: custom-sections/total is 0; blocked by ${name} (7 B)`]);
});
it('does not accept an absent census or inconsistent byte totals as zero',()=>{
  expect(customSectionsZeroFailures(zero,{})).toEqual(['Zero custom-section census must include canonical products']);
  expect(customSectionsZeroFailures(zero,{a:{customSections:[],customSectionBytes:7}})).toEqual(['a: custom-section byte census differs from its files']);
});

it('requires its own zero policy rather than an inherited allowance',()=>{
  const inherited:Record<string,unknown>={};Object.setPrototypeOf(inherited,{'custom-sections/total':0});
  expect(zeroPolicyFailures(inherited)).toEqual(['custom-sections/total must equal 0']);
});
