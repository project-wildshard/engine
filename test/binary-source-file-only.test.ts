import {expect,test,vi} from 'vitest';
import {binarySourceBytes,prepareBinarySources} from '../src/client/game/models/binarySource';

const inline={data:'eJxj+M/SAAADiQGE'};
test('a later inline binary request refuses before product capabilities are read',async()=>{
  const file=vi.fn(()=>Promise.resolve(new Uint8Array(4))),hasFile=vi.fn(()=>true);let capabilities=0;
  const product={get file(){capabilities++;return file;},get hasFile(){capabilities++;return hasFile;}};
  await expect(prepareBinarySources(product,[{source:{file:'shape'},bytes:4},{source:inline,bytes:4}])).rejects.toThrow('Binary sources require named files');
  expect(capabilities).toBe(0);expect(file).not.toHaveBeenCalled();expect(hasFile).not.toHaveBeenCalled();
});

test('direct inline binary intake refuses before touching prepared storage',()=>{
  const files=new Map<string,Uint8Array>(),get=vi.spyOn(files,'get');
  expect(()=>binarySourceBytes(inline,files)).toThrow('Binary sources require named files');
  expect(get).not.toHaveBeenCalled();
});
