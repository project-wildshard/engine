import {expect,test,vi} from 'vitest';
import {readScalarChannel,readScalarLattice,ScalarLatticeBindings} from '../src/shared/engine/world/scalarChannel';

const inline={type:'f32',count:4,data:'eJxjYEAFAAAQAAE='};
const lattice={res:2,size:32,values:inline};
test('direct scalar and lattice readers refuse inline storage before block access',()=>{
  const blocks=new Map<string,Uint8Array>(),get=vi.spyOn(blocks,'get');
  expect(()=>readScalarChannel(inline,blocks)).toThrow('Scalar channels require binary files');
  expect(()=>readScalarLattice(lattice,blocks)).toThrow('Scalar channels require binary files');
  expect(get).not.toHaveBeenCalled();
});
test('binding registration refuses inline channels and lattices without retaining a file or publishing a sampler',()=>{
  const bindings=new ScalarLatticeBindings();
  expect(()=>bindings.channel(inline)).toThrow('Scalar channels require binary files');
  expect(()=>bindings.lattice(lattice)).toThrow('Scalar channels require binary files');
  expect(bindings.files).toEqual([]);expect(bindings.prepared).toBe(true);
  const sample=bindings.lattice({...lattice,values:{...inline,data:{file:'world/lattice.bin'}}});
  expect(bindings.files).toEqual(['world/lattice.bin']);expect(bindings.prepared).toBe(false);
  expect(()=>bindings.channel(inline)).toThrow('Scalar channels require binary files');
  expect(()=>bindings.lattice(lattice)).toThrow('Scalar channels require binary files');
  expect(bindings.files).toEqual(['world/lattice.bin']);expect(()=>sample(0,0)).toThrow('not prepared');
});
